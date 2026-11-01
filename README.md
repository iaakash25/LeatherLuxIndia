# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

### Run everything in VS Code

The store has two parts: the storefront (this folder) and the API in `server/` (needs `server/.env`, see `server/README.md`).

1. Open this folder in VS Code and accept the recommended extensions.
2. Run `npm i` here and in `server/` once.
3. Press **Ctrl+Shift+B** (or Terminal → Run Build Task → *Start LLX*) to start both servers, then open http://localhost:5173.
4. To debug the API, press **F5** and choose *LLX: API + storefront (Edge)* or *(Chrome)*. Stop the *API: dev* task first, because both use port 4000.

Other tasks (Terminal → Run Task): *API: check database connection*, *API: tests*, *Storefront: tests*, *Typecheck: all*.

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS
