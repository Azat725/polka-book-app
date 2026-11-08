from celery import shared_task


@shared_task(ignore_result=True)
def process_pending_jobs():
    from .processing import process_pending

    return process_pending()


@shared_task(ignore_result=True)
def clean_uploads():
    from .storage import clean_expired_uploads

    clean_expired_uploads()
