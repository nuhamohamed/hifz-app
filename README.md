# Hifz App

Expo app for Hifz memorization.

## Environment variables

Create a `.env` file in the project root with the following:

| Variable | Description |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Your Supabase project URL (required) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase anon (public) API key (required) |
| `EXPO_PUBLIC_OPENAI_API_KEY` | OpenAI API key used for Whisper speech recognition (required) |

Copy the Supabase values from [Supabase](https://supabase.com/dashboard) → Project Settings → API.  
Copy the OpenAI key from [OpenAI](https://platform.openai.com/api-keys).

```bash
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url_here
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
EXPO_PUBLIC_OPENAI_API_KEY=your_openai_api_key_here
```

`.env` is gitignored and must not be committed. After changing env vars, restart the Expo dev server.

## Getting started

```bash
npm install
npm start
```
