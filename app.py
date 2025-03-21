from shiny import App, ui, reactive, render
import asyncio
import websockets
import json
import pandas as pd
import plotly.graph_objects as go
from datetime import datetime
import threading
import queue
import logging

# Set up logging for debugging
logging.basicConfig(level=logging.INFO)

# Thread-safe queue for WebSocket updates
update_queue = queue.Queue()

# Global state
rooms = {}  # Dictionary to store room data
ws_connected = False  # WebSocket connection status
esp32_ip = "192.168.183.165"  # Default ESP32 IP (adjust as needed)
WS_SERVER_URL = f"ws://{esp32_ip}:81"
reconnect_event = threading.Event()  # Event to signal WebSocket reconnection

#### WebSocket Handling

async def connect_websocket():
    """Connect to the ESP32 WebSocket server and process incoming messages."""
    global ws_connected
    while True:
        try:
            async with websockets.connect(WS_SERVER_URL) as websocket:
                # Identify this client to the server
                await websocket.send(json.dumps({"type": "identify", "client": "shiny"}))
                update_queue.put({"type": "ws_connected", "value": True})
                ws_connected = True
                while not reconnect_event.is_set():
                    try:
                        message = await asyncio.wait_for(websocket.recv(), timeout=1.0)
                        data = json.loads(message)
                        if data.get("type") == "rooms":
                            # Update rooms dictionary with new data
                            update_queue.put({"type": "rooms", "value": {room["id"]: room for room in data["rooms"]}})
                    except asyncio.TimeoutError:
                        continue  # No message, keep checking
                    except websockets.ConnectionClosed:
                        break
                reconnect_event.clear()  # Reset the event after exiting inner loop
        except Exception as e:
            logging.error(f"WebSocket connection failed: {e}")
            update_queue.put({"type": "ws_connected", "value": False})
            ws_connected = False
            await asyncio.sleep(5)  # Wait before retrying

def start_websocket():
    """Run the WebSocket connection in a separate thread."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(connect_websocket())

# Start WebSocket thread
websocket_thread = threading.Thread(target=start_websocket, daemon=True)
websocket_thread.start()

async def send_command(action, **kwargs):
    """Send a command to the ESP32 via WebSocket."""
    try:
        async with websockets.connect(WS_SERVER_URL) as websocket:
            command = {"type": "command", "action": action, **kwargs}
            await websocket.send(json.dumps(command))
            logging.info(f"Sent command: {command}")
    except Exception as e:
        logging.error(f"Command send failed: {e}")

#### Power Graph Generation

def create_power_graph(room_id):
    """Generate a real-time power consumption graph for a room."""
    room = rooms.get(room_id)
    if not room or "display_power" not in room:
        return None

    current_time = datetime.now()
    if "data" not in room:
        room["data"] = []
    room["data"].append({"timestamp": current_time, "power": room["display_power"]})
    if len(room["data"]) > 50:  # Limit data points
        room["data"].pop(0)

    df = pd.DataFrame(room["data"])

    fig = go.Figure()
    fig.add_trace(go.Scatter(
        x=df["timestamp"],
        y=df["power"],
        name="Power",
        line=dict(color="blue", width=2)
    ))
    fig.add_hline(
        y=room["threshold"],
        line_dash="dash",
        line_color="red",
        annotation_text="Threshold"
    )
    fig.update_layout(
        title=f"{room['name']} Power Consumption",
        xaxis_title="Time",
        yaxis_title="Power (W)",
        height=400
    )
    return fig

#### UI Definition

app_ui = ui.page_sidebar(
    ui.sidebar(
        ui.h4("Configuration"),
        ui.input_text("esp32_ip", "ESP32 IP Address", value=esp32_ip),
        ui.output_text("connection_status"),
        ui.h4("Room Management"),
        ui.input_checkbox("show_add_room", "Add New Room", False),
        ui.panel_conditional(
            "input.show_add_room",
            ui.input_text("new_room_name", "Room Name"),
            ui.input_numeric("new_threshold", "Power Threshold (W)", value=2500, min=100, max=10000),
            ui.input_numeric("meas_pin", "Measurement Relay GPIO Pin", value=25, min=0, max=39),
            ui.input_numeric("cutoff_pin", "Cutoff Relay GPIO Pin", value=26, min=0, max=39),
            ui.input_action_button("add_room", "Add Room")
        )
    ),
    main=ui.panel(
        ui.h2("Power Monitoring Dashboard"),
        ui.output_ui("rooms_display")
    )
)

#### Server Logic

def server(input, output, session):
    global rooms, ws_connected, WS_SERVER_URL, esp32_ip

    @reactive.Effect
    def update_from_queue():
        """Process updates from the WebSocket queue."""
        while not update_queue.empty():
            update = update_queue.get()
            if update["type"] == "ws_connected":
                ws_connected = update["value"]
            elif update["type"] == "rooms":
                rooms.clear()
                rooms.update(update["value"])
                logging.info(f"Updated rooms: {list(rooms.keys())}")

    @reactive.Effect
    @reactive.event(input.esp32_ip)
    def update_ip():
        """Update WebSocket URL and trigger reconnection when IP changes."""
        global WS_SERVER_URL, esp32_ip
        esp32_ip = input.esp32_ip()
        WS_SERVER_URL = f"ws://{esp32_ip}:81"
        reconnect_event.set()  # Signal WebSocket to reconnect
        logging.info(f"Updated ESP32 IP to {esp32_ip}")

    @output
    @render.text
    def connection_status():
        """Display WebSocket connection status."""
        return "Connected to ESP32" if ws_connected else "Disconnected from ESP32"

    @output
    @render.ui
    def rooms_display():
        """Render dynamic room cards."""
        if not rooms:
            return ui.p("No rooms available. Add a room using the sidebar.")

        room_cards = []
        for room_id, room in rooms.items():
            card = ui.card(
                ui.card_header(room["name"]),
                ui.input_numeric(
                    f"threshold_{room_id}",
                    "Threshold (W)",
                    value=float(room["threshold"]),
                    min=100,
                    max=10000
                ),
                ui.output_text(f"status_{room_id}"),
                ui.output_plot(f"graph_{room_id}"),
                ui.row(
                    ui.column(6, ui.input_action_button(f"reset_{room_id}", "Reset Power")),
                    ui.column(6, ui.input_action_button(f"delete_{room_id}", "Delete Room"))
                )
            )
            room_cards.append(card)
        return ui.div(*room_cards)

    # Dynamic outputs and event handlers for each room
    @reactive.Effect
    def register_dynamic_outputs():
        """Register dynamic outputs and handlers for each room."""
        for room_id in list(rooms.keys()):
            # Create a closure for each room_id
            def create_status_renderer(r_id):
                @output(id=f"status_{r_id}")
                @render.text
                def status_text():
                    room = rooms.get(r_id)
                    if not room:
                        return ""
                    status = ""
                    if room.get("isCutoff", False):
                        status += "⚠️ Power Cut Off - Threshold Exceeded!\n"
                    if room.get("bypassDetected", False):
                        status += "⚡ Potential Bypass Detected!"
                    return status
                return status_text
            
            def create_graph_renderer(r_id):
                @output(id=f"graph_{r_id}")
                @render.plot
                def graph_plot():
                    return create_power_graph(r_id)
                return graph_plot
            
            def create_reset_handler(r_id):
                @reactive.Effect
                @reactive.event(input[f"reset_{r_id}"])
                def reset_handler():
                    asyncio.run(send_command("reconnect", room_id=r_id))
                return reset_handler
            
            def create_delete_handler(r_id):
                @reactive.Effect
                @reactive.event(input[f"delete_{r_id}"])
                def delete_handler():
                    asyncio.run(send_command("remove", room_id=r_id))
                    if r_id in rooms:
                        del rooms[r_id]
                        logging.info(f"Deleted room: {r_id}")
                return delete_handler
            
            def create_threshold_handler(r_id):
                @reactive.Effect
                @reactive.event(input[f"threshold_{r_id}"])
                def threshold_handler():
                    new_threshold = input[f"threshold_{r_id}"]()
                    if new_threshold is not None and r_id in rooms:
                        asyncio.run(send_command("update", room_id=r_id, threshold=float(new_threshold)))
                        rooms[r_id]["threshold"] = new_threshold
                        logging.info(f"Updated threshold for room {r_id} to {new_threshold}")
                return threshold_handler
            
            # Register all handlers for this room
            create_status_renderer(room_id)
            create_graph_renderer(room_id)
            create_reset_handler(room_id)
            create_delete_handler(room_id)
            create_threshold_handler(room_id)

    @reactive.Effect
    @reactive.event(input.add_room)
    def handle_add_room():
        """Add a new room via WebSocket command."""
        room_id = f"room_{len(rooms) + 1}"
        asyncio.run(send_command(
            "add",
            room_id=room_id,
            name=input.new_room_name(),
            threshold=float(input.new_threshold()),
            meas_pin=int(input.meas_pin()),
            cutoff_pin=int(input.cutoff_pin())
        ))
        logging.info(f"Sent add command for room: {room_id}")

app = App(app_ui, server)