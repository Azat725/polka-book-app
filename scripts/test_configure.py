import importlib.util
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location("configure", Path(__file__).with_name("configure.py"))
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


def test_configuration_rejects_shell_and_environment_injection():
    for domain in ["https://books.example.com", "a.example.com\nPASSWORD=oops", "example.com;rm", "../../file"]:
        with pytest.raises(ValueError):
            configure.validate_domain(domain)


def test_secrets_are_independent_and_validated_without_writing_files():
    values = configure.build_environment("books.example.com", "@books_test_bot", "owner@example.com", "123456789:" + "x" * 32)
    assert values["TELEGRAM_BOT_USERNAME"] == "books_test_bot"
    assert len({values[key] for key in ["DJANGO_SECRET_KEY", "POSTGRES_PASSWORD", "REDIS_PASSWORD", "RESTIC_PASSWORD"]}) == 4
    with pytest.raises(ValueError):
        configure.build_environment("books.example.com", "bad\nDOMAIN=x", "owner@example.com", "123456789:" + "x" * 32)
