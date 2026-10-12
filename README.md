# 🎵 SyncWave — Listen Together, in Perfect Sync

**SyncWave** is a real-time collaborative music listening platform that lets you create shared listening sessions with friends. Upload songs, play them in perfect sync across all participants, chat, and create polls — all in real time.

> 🎧 *"Music Sessions with Friends"*

---

## 📖 Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Real-Time Events (Socket.io)](#real-time-events-socketio)
- [Authentication Flow](#authentication-flow)
- [How It Works](#how-it-works)
- [Setup Guide](#setup-guide)
- [Deployment](#deployment)
- [License](#license)

---

## Overview

SyncWave solves the problem of listening to music together when you're apart. Unlike simply sharing a link, SyncWave ensures every participant hears the **exact same part** of a song at the **exact same time** — no matter their network conditions or device.

A host creates a session, shares the session ID, and others join. Everyone in the session shares a single queue, synchronized playback controls, a live chat, and a polling system for group decisions like "what should we play next?"

---

## Key Features

### 🎶 Synchronized Music Playback
- Real-time playback synchronization across all connected clients
- Server-authoritative time tracking using `timesync` for clock-drift compensation
- Buffer-aware sync — if any participant is buffering, playback pauses for everyone to maintain sync
- Play, pause, seek, next, and previous controls broadcast to all participants

### 📂 Song Upload & Queue Management
- Upload audio files directly from the browser
- Files are stored in **Google Firebase Storage** for reliable, fast CDN-backed delivery
- Shared song queue visible to all participants
- Drag-to-reorder songs in the queue
- Remove songs from the queue

### 💬 Real-Time Chat
- In-session chat with message history
- Messages are persisted in MongoDB so late joiners can see the conversation
- Chat is scoped per session — each session has its own message history

### 📊 Live Polls
- Create polls within a session (e.g., "What album should we play next?")
- All participants can vote in real time
- Vote toggling (click again to remove your vote)
- Poll creator can delete polls
- Results update live for everyone

### 🔐 Authentication
- Email/password registration and login with **bcrypt** password hashing
- **Google OAuth 2.0** sign-in via Passport.js
- JWT-based session tokens (30-day expiry)
- Protected routes on both frontend and backend

### 👥 Session Management
- Create sessions with custom names
- Join sessions using a 6-character session ID
- Real-time participant count and participant list
- Automatic session cleanup — empty sessions are deleted after 5 minutes of inactivity
- Duplicate socket detection — prevents the same user from having multiple connections

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| **React 18** | UI framework |
| **React Router v6** | Client-side routing |
| **Material UI (MUI) v5** | Component library and icons |
| **Font Awesome** | Icon set |
| **Socket.io Client** | Real-time WebSocket communication |
| **Axios** | HTTP client for REST API calls |
| **Timesync** | Client-server clock synchronization |

### Backend
| Technology | Purpose |
|---|---|
| **Node.js + Express** | REST API server |
| **Socket.io** | WebSocket server for real-time events |
| **MongoDB + Mongoose** | Database and ODM |
| **Firebase Admin SDK** | Cloud file storage for audio files |
| **Passport.js** | Authentication middleware (local + Google OAuth) |
| **JWT (jsonwebtoken)** | Token-based authentication |
| **bcryptjs** | Password hashing |
| **Multer** | File upload handling |
| **Timesync** | Server-side time synchronization endpoint |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     CLIENT (React)                      │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │   Auth   │  │   Home   │  │ Session  │  │ Private│  │
│  │Component │  │   Page   │  │   Page   │  │ Route  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬───┘  │
│       │              │             │              │      │
│  ┌────┴──────────────┴─────────────┴──────────────┴───┐  │
│  │              AuthContext (React Context)            │  │
│  └────────────────────────┬───────────────────────────┘  │
│                           │                              │
│         ┌─────────────────┼─────────────────┐            │
│         │ REST (Axios)    │ WebSocket        │            │
│         │                 │ (Socket.io)      │            │
└─────────┼─────────────────┼─────────────────┼────────────┘
          │                 │                 │
          ▼                 ▼                 │
┌─────────────────────────────────────────────┼────────────┐
│                   SERVER (Express + Socket.io)           │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  Routes  │  │  Controllers │  │   Socket Handlers  │  │
│  │  /auth   │  │  authCtrl    │  │   create-session   │  │
│  │  /songs  │  │  songCtrl    │  │   join-session     │  │
│  │/sessions │  │  sessionCtrl │  │   play/pause/seek  │  │
│  └────┬─────┘  └──────┬───────┘  │   chat-message     │  │
│       │               │          │   polls / votes     │  │
│       │               │          └─────────┬──────────┘  │
│  ┌────┴───────────────┴────────────────────┴──────────┐  │
│  │              Middleware (JWT Auth, Multer)          │  │
│  └────────────────────────┬───────────────────────────┘  │
│                           │                              │
│         ┌─────────────────┼─────────────────┐            │
│         ▼                                   ▼            │
│  ┌──────────────┐                  ┌─────────────────┐   │
│  │   MongoDB    │                  │ Firebase Storage │   │
│  │  (Mongoose)  │                  │  (Audio Files)   │   │
│  └──────────────┘                  └─────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Authentication**: Client sends credentials → Server validates → Returns JWT → Client stores token in localStorage
2. **Session Creation**: Client emits `create-session` via Socket.io → Server creates session in MongoDB + in-memory Map → Returns session ID
3. **Song Upload**: Client sends file via REST (`POST /api/songs/upload`) → Server streams to Firebase → Returns public URL → Broadcasts to all session participants via Socket.io
4. **Playback Sync**: Host plays/pauses/seeks → Socket.io event emitted → Server updates authoritative state → Broadcasts to all clients → Clients adjust their local playback

---

## Project Structure

```
syncwave/
├── Backend/
│   ├── config/
│   │   ├── db.js                  # MongoDB connection setup
│   │   ├── firebase.js.production # Firebase Admin SDK config (production)
│   │   └── passport.js            # Passport.js strategies (local + Google OAuth)
│   ├── controllers/
│   │   ├── authController.js      # Register, login, profile handlers
│   │   ├── sessionController.js   # Session CRUD operations
│   │   └── songController.js      # Song upload, retrieval, streaming
│   ├── middleware/
│   │   └── auth.js                # JWT token verification middleware
│   ├── models/
│   │   ├── Session.js             # Session schema (songs, participants, chat, polls)
│   │   ├── Song.js                # Song schema (title, artist, Firebase URL)
│   │   └── User.js                # User schema (name, email, password, Google ID)
│   ├── routes/
│   │   ├── authRoutes.js          # /api/auth/* endpoints
│   │   ├── sessionRoutes.js       # /api/sessions/* endpoints
│   │   └── songRoutes.js          # /api/songs/* endpoints
│   ├── server.js                  # Main entry point — Express app, Socket.io, all real-time logic
│   ├── deploy-setup.js            # Production deployment helper
│   └── package.json
│
├── frontend/
│   ├── public/                    # Static assets (index.html, logo, etc.)
│   ├── src/
│   │   ├── components/
│   │   │   ├── Auth/
│   │   │   │   └── Auth.js        # Login/Signup form component
│   │   │   └── PrivateRoute.js    # Route guard — redirects unauthenticated users
│   │   ├── context/
│   │   │   └── AuthContext.js     # React Context for auth state management
│   │   ├── pages/
│   │   │   ├── AuthRedirect.js    # Handles Google OAuth callback redirect
│   │   │   ├── Home.js            # Landing page — create/join session
│   │   │   ├── Home.css
│   │   │   ├── Session.js         # Main session page — player, chat, queue, polls
│   │   │   └── Session.css
│   │   ├── services/
│   │   │   └── authServices.js    # API helper functions for auth endpoints
│   │   ├── App.js                 # Root component with routing
│   │   ├── App.css
│   │   ├── Auth.css               # Shared auth page styles
│   │   ├── index.js               # React entry point
│   │   └── index.css
│   └── package.json
│
└── README.md
```

---

## Database Schema

### User
| Field | Type | Description |
|---|---|---|
| `name` | String (required) | Display name |
| `email` | String (required, unique) | Email address |
| `password` | String | Hashed password (bcrypt) — empty for Google OAuth users |
| `googleId` | String | Google OAuth identifier |
| `avatar` | String | Profile picture URL |
| `createdAt` | Date | Account creation timestamp |

### Session
| Field | Type | Description |
|---|---|---|
| `sessionId` | String (required, unique, indexed) | 6-character session identifier |
| `name` | String | Session display name |
| `host` | ObjectId → User | Session creator |
| `participants` | [ObjectId → User] | Active participants |
| `songs` | [{ name, url, addedAt }] | Song queue |
| `currentSong` | { name, url, startedAt } | Currently playing song |
| `currentTime` | Number | Playback position in seconds |
| `isPlaying` | Boolean | Whether playback is active |
| `lastUpdate` | Date (indexed) | Last state change timestamp |
| `messages` | [{ text, sender, senderName, type, poll, timestamp }] | Chat history (includes polls) |

### Song
| Field | Type | Description |
|---|---|---|
| `title` | String (required) | Song title |
| `artist` | String | Artist name (default: "Unknown") |
| `duration` | Number | Duration in seconds |
| `firebaseUrl` | String (required) | Firebase Storage public URL |
| `uploadedBy` | ObjectId → User | Uploader |
| `session` | ObjectId → Session | Associated session |
| `uploadedAt` | Date | Upload timestamp |

---

## API Reference

### Authentication — `/api/auth`

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/register` | Public | Register a new user |
| `POST` | `/login` | Public | Login and receive JWT |
| `GET` | `/profile` | Private | Get authenticated user's profile |
| `GET` | `/google` | Public | Initiate Google OAuth flow |
| `GET` | `/google/callback` | Public | Google OAuth callback (redirects to frontend) |

### Songs — `/api/songs`

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/upload` | Private | Upload an audio file to a session (multipart/form-data) |
| `GET` | `/session/:sessionId` | Private | Get all songs in a session |
| `GET` | `/:id/stream` | Private | Stream/redirect to a song's audio file |

### Sessions — `/api/sessions`

| Method | Endpoint | Access | Description |
|---|---|---|---|
| Various | Various | Private | Session CRUD operations |

### Time Sync

| Method | Endpoint | Access | Description |
|---|---|---|---|
| `POST` | `/timesync` | Public | Returns server timestamp for clock synchronization |

---

## Real-Time Events (Socket.io)

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `create-session` | `{ sessionId, sessionName, userId }` | Create a new listening session |
| `join-session` | `{ sessionId, userId, username, sessionName }` | Join an existing session |
| `upload-songs` | `{ sessionId, songs[] }` | Add songs to the session queue |
| `play-song` | `{ sessionId, song, currentTime, isPlaying }` | Start playing a specific song |
| `play-pause` | `{ sessionId, isPlaying, currentTime, timestamp }` | Toggle playback state |
| `seek` | `{ sessionId, currentTime, isPlaying, timestamp }` | Seek to a position in the song |
| `next-song` | `{ sessionId, song, timestamp }` | Skip to the next song |
| `previous-song` | `{ sessionId, song, timestamp }` | Go to the previous song |
| `remove-song` | `{ sessionId, songName }` | Remove a song from the queue |
| `reorder-songs` | `{ sessionId, songs[] }` | Reorder the song queue |
| `chat-message` | `{ sessionId, message }` | Send a chat message |
| `new-poll` | `{ sessionId, poll }` | Create a new poll |
| `poll-vote` | `{ sessionId, pollId, optionIndex, voter }` | Vote on a poll option |
| `delete-poll` | `{ sessionId, pollId }` | Delete a poll |
| `player-ready` | `{ sessionId, userId, timestamp }` | Signal that local player is ready |
| `request-sync` | `{ sessionId, clientTime }` | Request a sync correction from the server |
| `sync-check` | `{ sessionId, clientTime, bufferProgress, isBuffering }` | Report buffering state |
| `buffer-state` | `{ sessionId, bufferProgress, isBuffering }` | Update buffer progress |
| `update-session-name` | `{ sessionId, sessionName }` | Rename the session |
| `user-leave-session` | `{ sessionId, userId }` | Leave the session |

### Server → Client

| Event | Payload | Description |
|---|---|---|
| `session-created` | `{ sessionId, sessionName, participantCount }` | Confirms session creation |
| `session-state` | Full session object | Complete session state for new joiners |
| `session-not-found` | `{ sessionId }` | Session ID doesn't exist |
| `session-name-updated` | `{ sessionName }` | Session was renamed |
| `songs-updated` | `songs[]` | Updated song queue |
| `song-update` | `{ song, currentTime, isPlaying, timestamp, ... }` | Playback state change |
| `next-song` | `{ song, timestamp, currentTime, isPlaying }` | Next song is playing |
| `previous-song` | `{ song, timestamp, currentTime, isPlaying }` | Previous song is playing |
| `participant-count` | `count` | Updated participant count |
| `user-joined` | `{ userId, username, participantCount }` | New user joined |
| `user-left` | `{ userId, participantCount }` | User left the session |
| `chat-message` | Message object | New chat message received |
| `new-poll` | `{ type, poll, sender, timestamp }` | New poll created |
| `poll-vote` | `{ pollId, optionIndex, voter, updatedOption }` | Vote update |
| `poll-deleted` | `{ pollId, timestamp }` | Poll was deleted |
| `sync-response` | `{ currentTime, serverTime, clientTime, syncId }` | Time sync correction |
| `sync-countdown` | `{ startTime }` | Countdown before synchronized playback start |
| `start-sync-playback` | `{ timestamp, currentTime, isPlaying }` | Begin synchronized playback |
| `buffer-update` | `{ avgBufferProgress, anyBuffering, timestamp }` | Buffer state across all clients |
| `ready-state-update` | `{ userId, ready, readyCount, totalCount }` | Player readiness update |

---

## Authentication Flow

### Email/Password
```
1. User fills out registration/login form
2. Frontend sends POST to /api/auth/register or /api/auth/login
3. Server validates credentials, hashes password (register), or compares hash (login)
4. Server returns JWT token + user object
5. Frontend stores token in localStorage via AuthContext
6. All subsequent API requests include token in Authorization header
7. PrivateRoute component redirects to /auth/login if no token exists
```

### Google OAuth 2.0
```
1. User clicks "Sign in with Google"
2. Frontend redirects to /api/auth/google
3. Passport.js initiates Google OAuth flow
4. User authenticates with Google
5. Google redirects to /api/auth/google/callback
6. Server creates/finds user, generates JWT
7. Server redirects to frontend /auth/redirect?token=<JWT>
8. AuthRedirect component extracts token, stores in localStorage, redirects to /home
```

---

## How It Works

### Playback Synchronization (Deep Dive)

SyncWave uses a **server-authoritative** model for playback synchronization:

1. **Timesync Protocol**: On connection, clients synchronize their clocks with the server using the `timesync` library. This accounts for network latency and clock drift between devices.

2. **Server as Source of Truth**: The server maintains the authoritative playback state (`currentTime`, `isPlaying`, `lastUpdate`) both in-memory (for speed) and in MongoDB (for persistence).

3. **Event Broadcasting**: When any client performs a playback action (play, pause, seek), the event goes to the server first, which updates its state and then broadcasts to **all** clients (including the sender).

4. **Buffer-Aware Sync**: Clients periodically report their buffering state. If any client is buffering, the server can signal all clients to pause, ensuring no one falls behind.

5. **Ready-State Coordination**: Before starting a new song, all participants signal readiness. Once everyone is ready, the server calculates a synchronized start time (2 seconds in the future) and broadcasts a countdown. All clients start playback at the exact same server timestamp.

6. **Automatic Cleanup**: Sessions with zero participants are automatically deleted after 5 minutes. The server cleans up empty sessions on startup and tracks deletion timeouts per session.

### Session Lifecycle

```
Create Session → Share Session ID → Friends Join → Upload Songs
       ↓                                              ↓
   Host Controls ←──── Synchronized Playback ────→ All Listeners
       ↓                                              ↓
   Chat & Polls ←──── Real-Time Updates ──────→ All Participants
       ↓
   All Leave → 5-minute timeout → Session Auto-Deleted
```

---

## Setup Guide

### Prerequisites

Before starting, ensure you have the following installed:

- Node.js (v14 or higher)
- npm (v6 or higher)
- MongoDB (local installation or connection string to MongoDB Atlas)
- Google Firebase account (for storage)

### 1. Clone the Repository

```bash
git clone https://github.com/jayasen3933/SyncWave.git
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

### 4. Firebase Configuration

For file storage functionality, you need to set up Firebase:

1. Create a Firebase project at https://console.firebase.google.com/
2. Generate a service account key file
3. Place the service account key in `Backend/config/firebase.js`

### 5. Running the Application

#### Start MongoDB (if using local installation)

```bash
# Start MongoDB service
sudo service mongod start
```

#### Start Backend Server

```bash
# Navigate to the backend directory
cd Backend

# Run in development mode
npm run dev

# Or run in production mode
npm start
```

The backend server will start running on http://localhost:5000

#### Start Frontend Development Server

```bash
# Navigate to the frontend directory
cd ../frontend

# Start the development server
npm start
```

The frontend development server will start running on http://localhost:3000

---

## Deployment

### Building for Production

#### Backend

```bash
cd Backend
npm run build
```

#### Frontend

```bash
cd frontend
npm run build
```

This will create production-ready builds of both the frontend and backend.

### Deployment Steps

1. Deploy the backend to your server (e.g., Railway, Render, AWS EC2)
2. Deploy the frontend build directory to a static hosting service (e.g., Vercel, Netlify)
3. Update environment variables for production URLs
4. Ensure MongoDB Atlas connection string is configured for production

---

## Additional Notes

- The backend uses **Socket.io** for real-time communication — both REST and WebSocket connections run on the same Express server
- Make sure MongoDB is running before starting the backend
- The application requires Firebase for file storage — songs are uploaded to Firebase Storage and served via public CDN URLs
- Remember to run `npm install` in both Backend and frontend directories when setting up a new environment
- Session state is maintained both **in-memory** (for real-time performance) and in **MongoDB** (for persistence across server restarts)
- Database operations use a **retry mechanism** (up to 3 retries with 1-second delay) for resilience against transient failures

---

## License

ISC

---

<p align="center">
  <strong>SyncWave</strong> © 2025 — Listening Together 🎶
</p>