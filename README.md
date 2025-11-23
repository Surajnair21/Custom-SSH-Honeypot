# HONEY GUARD
🍯 Custom SSH Honeypot & Real-Time Dashboard
A lightweight SSH honeypot that logs unauthorized access attempts and visualizes them in real-time using a custom web interface.

🚀 Features
Fake SSH Server: Accepts connections and captures credentials.

Real-Time Logging: WebSocket integration streams attacks to the dashboard instantly.

Live Map/Dashboard: Visualize attacker IP addresses and session data.

🛠️ Project Structure

ssh-honeypot/
├── api/
│   ├── main.py          # FastAPI backend
│   └── ...
├── honeypot.py          # SSH Server script
├── frontend/            # HTML/JS Dashboard files
└── requirements.txt     # Dependencies

📦 Installation
Clone the repository:
git clone https://github.com/Surajnair21/Custom-SSH-Honeypot.git

Navigate to the project folder:
cd Custom-SSH-Honeypot

Install dependencies:
pip install -r requirements.txt

⚡ How to Run
You will need two separate terminal windows to run the project (one for the Honeypot and one for the API).

Terminal 1: Start the SSH Honeypot
This script runs the fake SSH server that listens for incoming connections.

## 1. Enter the directory
cd ssh-honeypot

## 2. Activate the Virtual Environment
## Windows:
.\venv\Scripts\activate
## Linux/Mac:
source venv/bin/activate

## 3. Start the Honeypot
python honeypot.py
Terminal 2: Start the API & Backend
This script handles the data processing and WebSocket connections for the dashboard.

## 1. Enter the API directory
cd ssh-honeypot/api

#3 2. Activate the Virtual Environment (if not already active)
## Windows:
..\venv\Scripts\activate
## Linux/Mac:
source ../venv/bin/activate

## 3. Run the Uvicorn Server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
🖥️ Access the Dashboard
Once both terminals are running, open your web browser and navigate to:
127.0.0.1:8080/

👉 http://127.0.0.1:8080
