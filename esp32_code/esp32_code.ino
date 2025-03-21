#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include <PZEM004Tv30.h>
#include <vector>

// WiFi credentials - Replace with your network details
const char* ssid = "Henry's Hotspot";
const char* password = "stormbless";

// PZEM sensor - Adjust pins as needed
PZEM004Tv30 pzem(Serial2, 16, 17);  // RX, TX pins for PZEM-004T

// WebSocket server - Listening on port 81
WebSocketsServer webSocket = WebSocketsServer(81);

// Room class definition
class EnergyRoom {
private:
    String id;
    uint8_t measSSRPin;      // Pin for PZEM reading relay
    uint8_t cutoffRelayPin;  // Pin for power cutoff relay
    float currentPower = -1;
    float lastValidPower = 0;
    unsigned long lastValidRead = 0;
    bool faultFlag = false;

public:
    String name;
    float threshold;
    bool isActive;

    EnergyRoom(String id, String name, uint8_t measPin, uint8_t cutoffPin, float threshold = 2500.0)
        : id(id), name(name), measSSRPin(measPin), cutoffRelayPin(cutoffPin), 
          threshold(threshold), isActive(true) {
        
        pinMode(measSSRPin, OUTPUT);
        pinMode(cutoffRelayPin, OUTPUT);
        digitalWrite(measSSRPin, LOW);
        digitalWrite(cutoffRelayPin, LOW);  // Initially allow power flow
    }

    String getId() const { return id; }
    uint8_t getMeasPin() const { return measSSRPin; }
    uint8_t getCutoffPin() const { return cutoffRelayPin; }

    void measure() {
        digitalWrite(measSSRPin, HIGH);  // Enable PZEM reading for this room
        delay(300);  // Wait for relay and reading to stabilize
        float newPower = pzem.power();
        digitalWrite(measSSRPin, LOW);   // Disable PZEM reading

        if (!isnan(newPower)) {
            currentPower = newPower;
            lastValidPower = newPower;
            lastValidRead = millis();
            
            // Check if power exceeds threshold
            if (currentPower > threshold) {
                digitalWrite(cutoffRelayPin, HIGH);  // Cut off power
            }
        }
        
        // Check for potential bypass
        faultFlag = (digitalRead(cutoffRelayPin) == HIGH) && (lastValidPower > 10.0);
    }

    float getCurrentPower() const { return currentPower; }
    float getLastValidPower() const { return lastValidPower; }

    void updateThreshold(float newThreshold) {
        threshold = constrain(newThreshold, 3.0, 10000.0);  // Updated min threshold to 3W
    }

    void resetPower() {
        digitalWrite(cutoffRelayPin, LOW);  // Restore power
        faultFlag = false;
    }

    float getDisplayPower() const { 
        return (currentPower >= 0) ? currentPower : lastValidPower; 
    }
    
    bool hasFault() const { return faultFlag; }
    bool isPowerCutoff() const { return digitalRead(cutoffRelayPin) == HIGH; }
    unsigned long getLastUpdate() const { return lastValidRead; }

    void toJson(JsonObject& obj) {
        obj["id"] = id;
        obj["name"] = name;
        obj["display_power"] = getDisplayPower();
        obj["current_power"] = getCurrentPower();
        obj["threshold"] = threshold;
        obj["isCutoff"] = isPowerCutoff();
        obj["bypassDetected"] = hasFault();
        obj["lastActiveTime"] = getLastUpdate();
    }
};

std::vector<EnergyRoom> rooms;
unsigned long roomMeasurementStartTime = 0;  // Tracks the start time for measuring a room
size_t currentRoomIndex = 0;  // Index of the room currently being measured
const unsigned long measurementPeriod = 10000;  // 10 seconds per room

void sendRoomData() {
    if (rooms.empty()) {
        return;
    }
    
    DynamicJsonDocument doc(1024);
    doc["type"] = "rooms";
    JsonArray roomsArray = doc.createNestedArray("rooms");
    
    for (auto& room : rooms) {
        JsonObject roomObj = roomsArray.createNestedObject();
        room.toJson(roomObj);
    }
    
    String message;
    serializeJson(doc, message);
    webSocket.broadcastTXT(message);
}

void webSocketEvent(uint8_t num, WStype_t type, uint8_t * payload, size_t length) {
    switch (type) {
        case WStype_DISCONNECTED:
            Serial.printf("Client %u disconnected\n", num);
            break;
            
        case WStype_CONNECTED:
            Serial.printf("Client %u connected\n", num);
            sendRoomData();  // Send current rooms data to the new client
            break;
            
        case WStype_TEXT:
            handleWebSocketMessage(payload, length);
            break;
    }
}

void handleWebSocketMessage(uint8_t * payload, size_t length) {
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload, length);
    
    if (error) {
        Serial.println("JSON parsing failed!");
        return;
    }
    
    // Handle command message from Streamlit
    if (doc["type"] == "command") {
        String action = doc["action"];
        String roomId = doc["room_id"];
        
        Serial.printf("Received command: %s for room %s\n", action.c_str(), roomId.c_str());
        
        if (action == "add") {
            String name = doc["name"];
            float threshold = doc["threshold"];
            uint8_t measPin = doc["meas_pin"];
            uint8_t cutoffPin = doc["cutoff_pin"];
            
            rooms.emplace_back(roomId, name, measPin, cutoffPin, threshold);
            Serial.printf("Added new room: %s\n", name.c_str());
            sendRoomData();
        }
        else if (action == "remove") {
            auto it = std::remove_if(rooms.begin(), rooms.end(),
                [roomId](const EnergyRoom& r){ return r.getId() == roomId; });
            
            if (it != rooms.end()) {
                digitalWrite(it->getCutoffPin(), LOW);
                rooms.erase(it, rooms.end());
                Serial.printf("Removed room ID: %s\n", roomId.c_str());
                sendRoomData();
            }
        }
        else if (action == "update") {
            float threshold = doc["threshold"];
            
            for (auto& room : rooms) {
                if (room.getId() == roomId) {
                    room.updateThreshold(threshold);
                    Serial.printf("Updated threshold for room %s to %.2f\n", 
                                 roomId.c_str(), threshold);
                    sendRoomData();
                    break;
                }
            }
        }
        else if (action == "reconnect") {
            for (auto& room : rooms) {
                if (room.getId() == roomId) {
                    room.resetPower();
                    Serial.printf("Reset power for room %s\n", roomId.c_str());
                    sendRoomData();
                    break;
                }
            }
        }
    }
}

void setup() {
    Serial.begin(115200);
    
    // Connect to WiFi
    WiFi.begin(ssid, password);
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println();
    Serial.print("Connected to WiFi, IP address: ");
    Serial.println(WiFi.localIP());  // Note this IP for Streamlit configuration
    
    // Start WebSocket server
    webSocket.begin();
    webSocket.onEvent(webSocketEvent);
    Serial.println("WebSocket server started");
}

void loop() {
    webSocket.loop();
    
    if (!rooms.empty()) {
        // Check if 10 seconds have passed for the current room
        if (millis() - roomMeasurementStartTime >= measurementPeriod) {
            // Move to the next room
            currentRoomIndex = (currentRoomIndex + 1) % rooms.size();
            roomMeasurementStartTime = millis();
            Serial.printf("Switching to room %s\n", rooms[currentRoomIndex].getId().c_str());
        }
        
        // Measure the current room every 1 second
        static unsigned long lastMeasure = 0;
        if (millis() - lastMeasure >= 1000) {
            rooms[currentRoomIndex].measure();
            lastMeasure = millis();
            
            // Send updated data to Streamlit
            sendRoomData();
        }
    }
}