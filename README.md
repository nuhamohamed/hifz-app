# Hifz App

Expo app for Hifz memorization.

## Environment variables

Create a `.env` file in the project root with the following. These variables are **required** for Supabase:

| Variable | Description |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon (public) API key |

Copy the values from [Supabase](https://supabase.com/dashboard) → Project Settings → API.

```bash
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url_here
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
```

`.env` is gitignored and must not be committed. After changing env vars, restart the Expo dev server.

## Getting started

```bash
npm install
npm start
```
