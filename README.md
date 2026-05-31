# Sistema SSU — Gestión de Vacaciones

Sistema web para la gestión de solicitudes de vacaciones del **Seguro Social Universitario (SSU)**. Permite a los funcionarios solicitar vacaciones, a los jefes y gerentes aprobarlas o rechazarlas, y a RRHH y Auditoría consultar el historial completo de cargos y saldos.

---

## Tecnologías

| Componente | Versión |
|---|---|
| Python | 3.11+ |
| Django | 6.0.5 |
| PostgreSQL | 16 |
| ReportLab | 4.5.1 |
| Pillow | 12.2.0 |
| psycopg2-binary | 2.9.12 |

---

## Módulos del sistema

| Módulo | Ruta | Roles con acceso |
|---|---|---|
| Dashboard principal | `/Index_Principal.html` | Todos |
| Perfil de funcionario | `/Perfil.html` | Todos |
| Gestión de funcionarios | `/Funcionarios.html` | RRHH, Administrador |
| Historial de cargos | `/HistorialCargos.html` | RRHH, Auditoría, Administrador |
| Solicitud de vacación | `/Vacaciones.html` | Funcionario, Administrador |
| Aprobación y rechazo | `/Aprobacion.html` | Jefe de Area, Gte. Adm., Gte. Salud, Gte. General, Administrador |
| Mis solicitudes | `/Solicitudes.html` | Funcionario, Administrador |
| Historial RRHH | `/HistorialRRHH.html` | RRHH, Administrador |
| Anulación y ajuste | `/Anulacion.html` | RRHH, Administrador |
| Reporte personal | `/ReporteP.html` | RRHH, Auditoría, Administrador |
| Reporte general | `/ReporteG.html` | RRHH, Auditoría, Administrador |
| Gestión de feriados | `/Feriados.html` | RRHH, Administrador |

---

## Estructura del proyecto

```
CORE_SSU/
├── accounts/       # Autenticación, roles, permisos y perfil de usuario
├── core/           # Feriados, unidades organizacionales, middleware de acceso
├── dashboard/      # Página principal (Index_Principal)
├── employees/      # Funcionarios e historial de cargos
├── vacations/      # Solicitudes, aprobaciones, saldos de vacaciones
├── reports/        # Reportes de personal y generales
├── config/         # Configuración Django (settings, urls, wsgi)
├── templates/      # Plantillas HTML por módulo
├── static/         # CSS, JS e imágenes
└── logs/           # Log de accesos denegados por rol
```

---

## Requisitos previos

- Python 3.11 o superior
- PostgreSQL 16
- `pip`
- Git

---

## Instalación paso a paso

### 1. Clonar el repositorio

```bash
git clone <url-del-repositorio>
cd CORE_SSU
```

### 2. Crear y activar el entorno virtual

```bash
# Windows
python -m venv .venv
.venv\Scripts\activate

# Linux / macOS
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 4. Crear la base de datos en PostgreSQL

Abrí psql o pgAdmin y ejecutá:

```sql
CREATE DATABASE db_core_ssu;
```

### 5. Configurar la conexión a la base de datos

Editá `config/settings.py` y ajustá el bloque `DATABASES` con tus credenciales:

```python
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'db_core_ssu',
        'USER': 'tu_usuario',
        'PASSWORD': 'tu_contraseña',
        'HOST': 'localhost',
        'PORT': '5432',
    }
}
```

### 6. Crear la carpeta de logs

```bash
# Windows
mkdir logs

# Linux / macOS
mkdir -p logs
```

### 7. Aplicar migraciones

```bash
python manage.py migrate
```

### 8. Crear el esquema de tablas personalizadas

Las tablas del sistema (funcionario, persona, historial_cargo, etc.) usan `managed = False`, por lo que deben crearse manualmente con el script SQL provisto o restaurando el backup de la base de datos.

```bash
# Si tenés un backup .sql:
psql -U postgres -d db_core_ssu -f backup_db_core_ssu.sql
```

### 9. Crear un superusuario de Django

```bash
python manage.py createsuperuser
```

### 10. Levantar el servidor de desarrollo

```bash
python manage.py runserver
```

Accedé en el navegador a: **http://127.0.0.1:8000**

---

## Variables de entorno (opcional)

Para no exponer credenciales en el código, podés usar un archivo `.env` en la raíz del proyecto:

```env
SECRET_KEY=tu-clave-secreta
DB_NAME=db_core_ssu
DB_USER=postgres
DB_PASSWORD=tu_contraseña
DB_HOST=localhost
DB_PORT=5432
DEBUG=True
```

Y en `settings.py` cargarlas con `python-dotenv` (ya incluido en `requirements.txt`):

```python
from dotenv import load_dotenv
import os

load_dotenv()

SECRET_KEY = os.getenv('SECRET_KEY')
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME':     os.getenv('DB_NAME'),
        'USER':     os.getenv('DB_USER'),
        'PASSWORD': os.getenv('DB_PASSWORD'),
        'HOST':     os.getenv('DB_HOST', 'localhost'),
        'PORT':     os.getenv('DB_PORT', '5432'),
    }
}
```

> Asegurate de agregar `.env` a tu `.gitignore`.

---

## Roles del sistema

| Rol | Descripción |
|---|---|
| `Funcionario` | Puede solicitar vacaciones y consultar su historial |
| `Jefe de Area` | Aprueba o rechaza solicitudes en el nivel 1 |
| `Gerente Administrativo` | Aprueba o rechaza en nivel 2 (subordinados) o nivel 1 (jefes de área) |
| `Gerente de Salud` | Igual que Gerente Administrativo |
| `Gerente General` | Aprueba en el nivel final de toda la jerarquía |
| `RRHH` | Gestiona funcionarios, feriados, anulaciones y reportes |
| `Auditoria` | Consulta de solo lectura: historial de cargos y reportes |
| `Administrador` | Acceso total al sistema |

---

## Flujo de aprobación de vacaciones

```
Funcionario solicita
        ↓
  Jefe de Área  (nivel 1) — solo para Subordinados
        ↓
  Gte. Adm./Salud (nivel 2) — Subordinados y Jefes de Área
        ↓
  Gerente General (nivel 3) — todos los tipos
        ↓
     APROBADA
```

Si cualquier nivel rechaza, el flujo se detiene y la solicitud queda como **RECHAZADA**.

---

## Notas técnicas

- **Zona horaria:** `America/La_Paz` (Bolivia, UTC-4)
- **Idioma:** Español (`es-ES`)
- **Columna generada:** `gestion_vacacion.dias_adeudados` es un campo `GENERATED ALWAYS AS ... STORED` en PostgreSQL — no se escribe desde el ORM.
- **Exportación PDF:** generada en el navegador con `window.print()`, no requiere librerías de servidor adicionales para los módulos de historial. ReportLab se usa exclusivamente para el formulario de solicitud de vacaciones en PDF.
- **Control de acceso:** implementado como middleware Django (`core.middleware.ControlAccesoRoles`) con una matriz de permisos centralizada en `core/permissions.py`.
- **Foto de perfil:** almacenada como `BinaryField` directamente en la tabla `persona`.

---

## Archivos que NO deben subirse al repositorio

Asegurate de que tu `.gitignore` incluya:

```
.env
.venv/
__pycache__/
*.pyc
logs/
db.sqlite3
```
