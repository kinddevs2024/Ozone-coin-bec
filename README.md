# Ozone-coin Backend

API для фронтенда Ozone-coin. MongoDB, Express, CORS.

## Запуск

1. Скопируй `.env.example` в `.env` и заполни `MONGODB_URI`, при необходимости `ADMIN_USER`, `ADMIN_PASSWORD`, `CORS_ORIGIN`.
2. `npm install`
3. `npm run dev` — сервер на http://localhost:3001

## Переменные окружения

- `MONGODB_URI` — строка подключения MongoDB
- `ADMIN_USER` / `ADMIN_PASSWORD` — логин админа
- `JWT_SECRET` — секрет для токенов (по умолчанию берётся пароль админа)
- `PORT` — порт (по умолчанию 3001)
- `CORS_ORIGIN` — разрешённый origin фронта (например `https://твой-фронт.vercel.app` или `http://localhost:5173`)

## Деплой

Бэкенд можно задеплоить на Railway, Render, Fly.io или как serverless (Vercel/Netlify Functions). На сервере обязательно задай `CORS_ORIGIN` равным URL твоего фронтенда.
