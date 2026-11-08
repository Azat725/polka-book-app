FROM postgres:17-alpine
RUN apk add --no-cache restic
COPY infra/backup/backup.sh /usr/local/bin/book-backup
COPY infra/backup/restore.sh /usr/local/bin/book-restore
RUN chmod 755 /usr/local/bin/book-backup /usr/local/bin/book-restore
ENTRYPOINT ["/usr/local/bin/book-backup"]
