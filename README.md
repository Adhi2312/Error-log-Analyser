# 🚀 Error Log Analyzer

> AI-powered log analysis platform that extracts, redacts, and analyzes software errors from log files using a modern full-stack architecture.

![React](https://img.shields.io/badge/React-19-blue)
![Node](https://img.shields.io/badge/Node.js-Express-green)
![Postgres](https://img.shields.io/badge/PostgreSQL-Database-blue)
![Redis](https://img.shields.io/badge/Redis-BullMQ-red)
![Docker](https://img.shields.io/badge/Docker-Compose-blue)

---

## 📖 Overview

Error Log Analyzer is a full-stack application that helps developers quickly inspect log files by:

- Uploading log/text files
- Detecting error entries
- Redacting sensitive information
- Generating structured AI-assisted analysis
- Supporting both background processing with BullMQ/Redis and a simpler direct mode

---

## ✨ Features

- 📂 Log file upload and error preview
- 🔍 Error extraction from logs
- 🔒 Sensitive data redaction
- 🤖 AI-assisted root cause analysis
- ⚡ Background processing using BullMQ
- 🧪 Direct mode for a small hosted demo without Redis or a worker
- 💾 PostgreSQL persistence
- 🔄 Automatic versioned database migrations
- 🎨 Responsive React UI

---

## 🏗️ Architecture

```text
                +----------------------+
                |      React UI        |
                +----------+-----------+
                           |
                     Axios API Calls
                           |
                +----------v-----------+
                |    Express Server    |
                +----------+-----------+
                           |
        +------------------+------------------+
        |                  |                  |
        |                  |                  |
     Parser           Redactor          Upload Service
        |                  |
        +---------+--------+
                  |
             BullMQ Queue
                  |
             Redis Worker
                  |
           AI Analysis Engine
                  |
             PostgreSQL DB
```

---

## 🛠️ Tech Stack

### Frontend

- React
- Tailwind CSS
- Axios
- React Icons

### Backend

- Node.js
- Express.js
- Multer

### Database

- PostgreSQL

### Queue

- Redis
- BullMQ

### AI

- NVIDIA NIM hosted inference API
- Configurable NVIDIA model and endpoint

### DevOps

- Docker
- Docker Compose

---

## 📁 Project Structure

```text
ERROR-LOG-ANALYZER/
│
├── backend/
│   ├── src/
│   │   ├── db/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── db.js
│   │   ├── queue.js
│   │   ├── server.js
│   │   └── worker.js
│   │
│   ├── uploads/
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── package.json
│   └── package-lock.json
│
├── documents/
│
├── Frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── package-lock.json
│
├── .gitignore
└── README.md
```

---

## ⚙️ How It Works

1. Upload a log file.
2. Backend parses the log.
3. Errors are extracted.
4. Sensitive information is redacted.
5. Preview is displayed.
6. In the default queue mode, every detected error is queued for background processing and workers analyze them independently. In direct mode, the browser requests each saved error's analysis from the API in turn.
8. Batch progress and individual results are displayed.
9. Analysis is stored for future reference.

---

## 🚀 Getting Started

### Clone

```bash
git clone https://github.com/Adhi2312/Error-log-Analyser.git
cd Error-log-Analyser
```

### Backend

```bash
cd backend
npm install
npm run migrate
npm start
```

Copy `backend/.env.example` to `backend/.env` and set `NVIDIA_API_KEY` before
starting analysis. The default hosted model is `openai/gpt-oss-20b`.

For a local backend run, set `ANALYSIS_MODE=direct` and a working `DATABASE_URL`
in `backend/.env`, then run `npm run start:local` from `backend` with Node 20.12
or newer. The API, migrations, and worker load `backend/.env` regardless of the
shell's current directory. Use
`localhost` in the database URL when PostgreSQL runs on your machine; the
`postgres` and `redis` hostnames in the example are for Docker Compose.
The regular `npm start` also loads the file when present; hosting environments
can supply variables directly without it.

### Direct mode for a small deployment

Set `ANALYSIS_MODE=direct` in the API environment, together with `DATABASE_URL`,
`NVIDIA_API_KEY`, and `CORS_ORIGIN` (the frontend's full origin). Run the API with
`npm start` so migrations are applied. Set `REACT_APP_API_URL` to the API's public
URL when building the frontend. Direct mode needs PostgreSQL but does not need
Redis, a cache, or a worker process.

Uploading saves every detected error in PostgreSQL. The browser then asks the API
to analyze each error separately; the API reads the stored text and **redacts it
on the server before sending it to NVIDIA NIM**. The preview response contains
only redacted error text. Progress and results stay in PostgreSQL. The browser
needs to remain open to start the remaining requests, although reopening the
page resumes the most recent unfinished direct upload. Failed errors can be
retried from the results page. This mode is intended for a small demo; for
unattended processing and automatic retries, keep the default `ANALYSIS_MODE=queue`
and run Redis plus the worker.

### Deploy on Render

The root `render.yaml` deploys the portfolio configuration in direct mode:

- a free Node web service for the API;
- a free static site for the React frontend; and
- a free Render PostgreSQL database in the same region as the API.

In Render, choose **New > Blueprint**, connect this repository, and select the
`main` branch. Render prompts for `NVIDIA_API_KEY`; paste the key there and do
not add it to Git. The Blueprint supplies the database connection, frontend API
URL, CORS origin, model, and health check automatically.

Render's free PostgreSQL databases are intended for demos and expire after 30
days. Upgrade the database or replace it before relying on it for permanent data.

### Frontend

```bash
cd Frontend
npm install
npm start
```

---

## 🐳 Docker

```bash
docker compose -f backend/docker-compose.yml up --build
```

The API and worker run all pending migrations before they start. Applied files are
recorded in the `schema_migrations` table and will not run again. To apply migrations
without starting the application:

```bash
docker compose -f backend/docker-compose.yml run --rm backend npm run migrate
```

Create new migrations in `backend/src/db/migrations` using the next three-digit
prefix, for example `003_add_upload_owner.sql`. Never edit a migration after it has
been applied; add a new migration instead.





---

## 👥 Contributors



###  [Adhilingavignesh K](https://github.com/Adhi2312)
###  [Prithiv Raj K](https://github.com/Prithivraj22)



---

