# 1. Use an official Python image
FROM python:3.12-slim

# 2. Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 3. Set the working directory inside the container
WORKDIR /code

# 4. Install MySQL system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    default-libmysqlclient-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# 5. Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install gunicorn  # Ensure gunicorn is installed for production

# 6. Copy your entire project structure into the container
COPY . .

# 7. Start the application using your 'config' folder
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000"]