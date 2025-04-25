# SyncWave - Setup Guide

This guide explains how to download and run the SyncWave application source code.

## Prerequisites

Before starting, ensure you have the following installed:

- Node.js (v14 or higher)
- npm (v6 or higher)
- MongoDB (local installation or connection string to MongoDB Atlas)
- Google Firebase account (for storage)

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/deekshith1707/syncwave.git
cd syncwave
```

### 2. Install Dependencies

> **Important**: You must install dependencies in both the Backend and frontend directories.

#### Backend Dependencies

```bash
# Navigate to the backend directory
cd Backend

# Install backend dependencies
npm install
```

#### Frontend Dependencies

```bash
# Navigate to the frontend directory from project root
cd frontend  # Or use: cd ../frontend (if you're currently in the Backend directory)

# Install frontend dependencies
npm install
```

### 3. Configure Environment Variables

#### Backend Configuration

```bash
# Navigate to the backend directory (if not already there)
cd Backend

# Create .env file with the following variables
touch .env
```

Add the following environment variables to your `.env` file:

```
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback
NODE_ENV=development
```

#### Frontend Configuration

```bash
# Navigate to the frontend directory (if not already there)
cd frontend  # Or use: cd ../frontend (if you're currently in the Backend directory)

# Create .env file with the following variables
touch .env
```

Add the following environment variables to your `.env` file:

```
REACT_APP_API_URL=http://localhost:5000
```

## Running the Application

### Start MongoDB (if using local installation)

```bash
# Start MongoDB service
sudo service mongod start
```

### Start Backend Server

```bash
# Navigate to the backend directory
cd Backend

# Run in development mode
npm run dev

# Or run in production mode
npm start
```

The backend server will start running on http://localhost:5000

### Start Frontend Development Server

```bash
# Navigate to the frontend directory
cd ../frontend

# Start the development server
npm start
```

The frontend development server will start running on http://localhost:3000

## Firebase Configuration

For file storage functionality, you need to set up Firebase:

1. Create a Firebase project at https://console.firebase.google.com/
2. Generate a service account key file
3. Place the service account key in `Backend/config/firebase.js`

## Building for Production

### Backend

```bash
cd Backend
npm run build
```

### Frontend

```bash
cd frontend
npm run build
```

This will create production-ready builds of both the frontend and backend.

## Deployment

For deployment, follow these steps:

1. Deploy the backend to your server
2. Deploy the frontend build directory to a static hosting service

## Additional Notes

- The backend uses Socket.io for real-time communication
- Make sure MongoDB is running before starting the backend
- The application requires Firebase for file storage
- Remember to run `npm install` in both Backend and frontend directories when setting up a new environment