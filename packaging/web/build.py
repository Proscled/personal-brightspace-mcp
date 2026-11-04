"""Build a portable remote MCP plugin ZIP from public configuration only."""

import argparse
import json
from pathlib import Path
import re
from tempfile import NamedTemporaryFile
from urllib.parse import urlsplit
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


HERE = Path(__file__).resolve().parent


def public_origin(value):
    """Accept a public DNS hostname, without an endpoint path or embedded data."""
    label = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    if not re.fullmatch(rf"https://(?:{label}\.)+[a-z]{{2,63}}(?::443)?/?", value, re.I | re.ASCII):
        raise ValueError("Use a public HTTPS origin on port 443, with a DNS name and no path or credentials.")
    parsed = urlsplit(value)
    host = parsed.hostname
    reserved = ("localhost", "local", "localdomain", "internal", "test", "invalid", "example",
                "onion", "arpa", "example.com", "example.net", "example.org", "brightspace.hhs.nl")
    if len(host) > 253 or any(host == name or host.endswith("." + name) for name in reserved):
        raise ValueError("Use the public hostname of the hosted study service.")
    return "https://" + host


def build(origin, client_id, output):
    origin = public_origin(origin)
    if not re.fullmatch(r"[A-Za-z0-9._~-]{1,160}", client_id):
        raise ValueError("Supply the registered OAuth client ID, using 1 to 160 letters, digits or . _ ~ -.")
    if output.suffix.lower() != ".zip":
        raise ValueError("Choose an output filename ending in .zip.")
    server = {
        "type": "streamable-http",
        "url": origin + "/mcp",
        "extensions": {"com.openai": {"auth": {
            "type": "oauth",
            "client": {"mode": "provided", "clientId": client_id,
                       "tokenEndpointAuthMethod": "client_secret_basic"},
            "authorizationUrl": origin + "/oauth/authorize",
            "tokenUrl": origin + "/oauth/token",
            "baseScopes": ["brightspace.read"],
        }}},
    }
    mcp = {"$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
           "mcpServers": {"brightspace": server}}
    files = {
        "plugin.json": (HERE / "plugin.json").read_bytes(),
        "mcp.json": (json.dumps(mcp, indent=2) + "\n").encode(),
        "assets/book.svg": (HERE / "assets/book.svg").read_bytes(),
    }
    with NamedTemporaryFile(dir=output.parent, delete=False) as tmp:
        path = Path(tmp.name)
    try:
        with ZipFile(path, "w") as archive:
            for name, content in files.items():
                entry = ZipInfo(name)  # Fixed ZIP epoch makes repeated builds identical.
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                archive.writestr(entry, content, compress_type=ZIP_DEFLATED)
        path.replace(output)
    finally:
        path.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True, help="Public HTTPS origin of the MCP service")
    parser.add_argument("--client-id", required=True, help="Registered public OAuth client identifier")
    parser.add_argument("--output", required=True, type=Path, help="Destination ZIP filename")
    args = parser.parse_args()
    try:
        build(args.origin, args.client_id, args.output)
    except (OSError, ValueError) as error:
        parser.exit(1, f"Cannot build plugin. {error}\n")
    print(f"Created {args.output}")
