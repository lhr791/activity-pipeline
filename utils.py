"""
Shared utilities: env loading, Supabase client, OpenAI client, logging.
"""

import os
import logging
from dotenv import load_dotenv
from supabase import create_client, Client as SupabaseClient
from openai import OpenAI

load_dotenv()

# ── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("tg-summarizer")

# ── Environment ──────────────────────────────────────────────────────────────

TG_API_ID = int(os.environ["TG_API_ID"])
TG_API_HASH = os.environ["TG_API_HASH"]
TG_PHONE = os.environ["TG_PHONE"]

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", None)

TARGET_CHAT_IDS: list[int] = [
    int(cid.strip())
    for cid in os.environ.get("TARGET_CHAT_IDS", "").split(",")
    if cid.strip()
]

SUMMARIZE_HOUR = int(os.environ.get("SUMMARIZE_HOUR", "9"))

# ── Clients ──────────────────────────────────────────────────────────────────


def get_supabase() -> SupabaseClient:
    """Return a Supabase client using service role key."""
    return create_client(SUPABASE_URL, SUPABASE_KEY)


def get_openai() -> OpenAI:
    """Return an OpenAI-compatible client (works with DeepSeek etc)."""
    kwargs = {"api_key": OPENAI_API_KEY}
    if OPENAI_BASE_URL:
        kwargs["base_url"] = OPENAI_BASE_URL
    return OpenAI(**kwargs)
