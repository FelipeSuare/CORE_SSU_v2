import os
from django import template
from django.contrib.staticfiles.finders import find
from django.templatetags.static import static

register = template.Library()


@register.simple_tag
def staticv(path):
    url = static(path)
    file_path = find(path)
    if file_path and os.path.exists(file_path):
        version = int(os.path.getmtime(file_path))
        return f"{url}?v={version}"
    return url
