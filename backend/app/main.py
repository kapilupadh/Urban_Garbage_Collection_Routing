from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from app.api import router

app = FastAPI(
    title="Urban Garbage Collection Route Optimization System",
    description="Directed Chinese Postman routing on OpenStreetMap roads with capacity-aware fleet trips.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)

project = Path(__file__).resolve().parents[2]
web_build = project / "frontend" / "out"
app.mount("/_next/static", StaticFiles(directory=web_build / "_next" / "static", check_dir=False), name="demo_assets")


@app.get("/", include_in_schema=False)
def demo_launcher():
    return FileResponse(project / "index.html")


@app.get("/demo", include_in_schema=False)
def browser_demo():
    index = web_build / "index.html"
    if index.is_file():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return PlainTextResponse("Build the demo with 'npm ci' and 'npm run build:demo' in frontend, then reload this page.", status_code=503)
