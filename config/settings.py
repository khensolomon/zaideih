"""
Django settings for Zaideih project.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

# Load the .env file from the root directory
env_path = os.path.join(BASE_DIR, '.env')
load_dotenv(dotenv_path=env_path)

# --- CRITICAL FOLDER STRUCTURE SETUP ---
# Add the 'apps' directory to the Python path 
APPS_DIR = os.path.join(BASE_DIR, 'apps')
sys.path.insert(0, APPS_DIR)

# --- SECURITY WARNING: keep the secret key used in production secret! ---
SECRET_KEY = os.environ.get('SECRET_KEY', 'fallback-secret-key')

# --- SECURITY WARNING: don't run with debug turned on in production! ---
DEBUG = os.environ.get('DEBUG', 'False') == 'True'

ALLOWED_HOSTS = ['*']

# Application definition
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # Third-party apps
    'rest_framework',
    'corsheaders',
    
    # Local apps inside the 'apps/' folder
    'core',
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware', # CORS must be at the top
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

# Vue frontend templates setup
TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [os.path.join(BASE_DIR, 'frontend_dist')], 
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

# Database Setup (Mapped directly from your .env)
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': os.environ.get('DB_NAME'),
        'USER': os.environ.get('DB_USER'),
        'PASSWORD': os.environ.get('DB_PWD'),
        'HOST': os.environ.get('DB_HOST', 'localhost'),
        'PORT': os.environ.get('DB_PORT', '3306'),
    }
}

# --- CUSTOM DIRECTORIES ---
STORAGE_DIR = os.environ.get('STORAGE_DIR')
CACHE_DIR = os.environ.get('CACHE_DIR')
MEDIA_DIR = os.environ.get('MEDIA_DIR')

MEDIA_ROOT = MEDIA_DIR

# --- STATIC FILES ---
STATIC_URL = 'static/'
STATICFILES_DIRS = [
    os.path.join(BASE_DIR, 'frontend_dist'), 
]

# --- GOOGLE CLOUD CONFIGURATION ---
GS_BUCKET_NAME = os.environ.get('GS_BUCKET_NAME')
os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = os.environ.get('GS_CREDENTIALS')

# --- CORS SETTINGS ---
CORS_ALLOW_ALL_ORIGINS = True