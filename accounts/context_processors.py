from employees.models import Persona


def foto_perfil(request):
    if not request.user.is_authenticated:
        return {'tiene_foto_perfil': False}
    try:
        persona = Persona.objects.only('foto').get(ci=request.user.username)
        return {'tiene_foto_perfil': bool(persona.foto)}
    except Persona.DoesNotExist:
        return {'tiene_foto_perfil': False}
