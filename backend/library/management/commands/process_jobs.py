import time

from django.core.management.base import BaseCommand

from library.processing import process_pending
from library.storage import clean_expired_uploads


class Command(BaseCommand):
    help = "Process persisted PDF jobs. Local alternative to Celery; never used inside an upload request."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        while True:
            process_pending(once=options["once"])
            clean_expired_uploads()
            if options["once"]:
                return
            time.sleep(2)
