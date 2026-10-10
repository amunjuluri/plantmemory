"""Print the API's OpenAPI schema as JSON, for generating the UI's TypeScript types.

Usage: uv run python -m scripts.export_openapi > web/openapi.json
"""

import json

from app.main import app

if __name__ == "__main__":
    print(json.dumps(app.openapi(), indent=1))
