"""Create a private deployment environment without printing credentials."""
import argparse
import getpass
import os
import re
import secrets
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def validate_domain(value):
    domain = value.strip().lower().encode("idna").decode("ascii")
    if len(domain) > 253 or not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}", domain):
        raise ValueError("Use a domain such as books.example.com, without https or a path.")
    return domain


def build_environment(domain, username, email, bot_token):
    domain = validate_domain(domain)
    username = username.strip().removeprefix("@")
    if not re.fullmatch(r"[A-Za-z0-9_]{5,32}", username):
        raise ValueError("Invalid Telegram bot username.")
    if not re.fullmatch(r"[^\s=@]+@[^\s=]+\.[^\s=]+", email) or any(c in email for c in "\r\n\"'`$"):
        raise ValueError("Invalid email address.")
    if not re.fullmatch(r"[0-9]{5,20}:[A-Za-z0-9_-]{20,200}", bot_token):
        raise ValueError("Enter the bot token from BotFather.")
    return {
        "DOMAIN": domain, "TELEGRAM_BOT_TOKEN": bot_token, "TELEGRAM_BOT_USERNAME": username,
        "ACME_EMAIL": email, "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
        "POSTGRES_DB": "books", "POSTGRES_USER": "books", "POSTGRES_PASSWORD": secrets.token_urlsafe(36),
        "REDIS_PASSWORD": secrets.token_urlsafe(36), "RESTIC_PASSWORD": secrets.token_urlsafe(48),
        "RESTIC_REPOSITORY": "", "AWS_ACCESS_KEY_ID": "", "AWS_SECRET_ACCESS_KEY": "",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain"); parser.add_argument("--bot-username"); parser.add_argument("--email")
    args = parser.parse_args()
    if (ROOT / ".env").exists():
        parser.error(".env already exists. Edit it deliberately; this tool never overwrites secrets.")
    try:
        values = build_environment(args.domain or input("Domain: "), args.bot_username or input("Bot username: "), args.email or input("ACME email: "), getpass.getpass("Bot token (hidden): "))
    except (ValueError, UnicodeError) as error:
        parser.error(str(error))
    descriptor = os.open(ROOT / ".env", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
        output.write("\n".join(f"{key}={value}" for key, value in values.items()) + "\n")
    print("Created .env. Store an encrypted copy of its secrets outside this server.")


if __name__ == "__main__":
    main()
