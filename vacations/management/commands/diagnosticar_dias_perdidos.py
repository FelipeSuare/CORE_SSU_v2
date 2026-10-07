from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Diagnostico de solo lectura: equivale a corregir_dias_perdidos --dry-run.'

    def handle(self, *args, **options):
        call_command('corregir_dias_perdidos', dry_run=True, stdout=self.stdout)
