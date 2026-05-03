from django.apps import AppConfig


class WorkerSyncConfig(AppConfig):
    """
    Django app config for worker_sync.

    The `ready()` hook imports signals.py, which has the side effect of
    connecting post_save / post_delete handlers on the Track model.
    """

    default_auto_field = "django.db.models.AutoField"
    name = "worker"

    def ready(self):
        # Importing the module connects the signal handlers via @receiver.
        from . import signals  # noqa: F401
