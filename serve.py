import os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from http.server import HTTPServer, SimpleHTTPRequestHandler
HTTPServer(("", 8080), SimpleHTTPRequestHandler).serve_forever()
