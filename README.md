# Tiny Atlas

Turn a real region into an illustrated miniature 3D map. Geometry comes from open data
(OSM + elevation), ComfyUI only paints texture, an LLM adds landmarks, stories and a guide.

## Run (phase 1: untextured terrain)
```
pip install -r backend/requirements.txt
cd backend && uvicorn tinyatlas.api:app --port 8000
# open http://localhost:8000/?region=hunza
python -m pytest backend/tests
```

Data attribution: elevation from Mapzen/AWS Terrain Tiles; map data © OpenStreetMap contributors (ODbL).
