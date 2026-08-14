#!/usr/bin/env python3
"""Servidor local para el Criadero. Solo usa la librería estándar de Python.
Uso:  python3 server.py   (luego abre http://localhost:8000 en tu navegador)
"""
import http.server
import socketserver
import os
import webbrowser

PORT = 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".glb": "model/gltf-binary"}

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    url = f"http://localhost:{PORT}"
    print(f"Sirviendo el Criadero en {url}  (Ctrl+C para detener)")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    httpd.serve_forever()
