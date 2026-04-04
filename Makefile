.PHONY: dev dev-backend dev-frontend test test-backend lint install

# Start all services via docker-compose
dev:
	docker compose up --build

# Run backend locally (requires MongoDB and Redis running)
dev-backend:
	cd backend && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Run frontend locally
dev-frontend:
	cd frontend && npm run dev

# Install all dependencies
install:
	cd backend && pip install -e ".[dev]"
	cd frontend && npm install

# Run backend tests
test:
	cd backend && python -m pytest -v

# Run a single backend test
test-one:
	cd backend && python -m pytest -v -k "$(TEST)"

# Lint backend
lint:
	cd backend && ruff check app/ tests/
	cd backend && ruff format --check app/ tests/

# Format backend
format:
	cd backend && ruff format app/ tests/

# Start demo (production-like) stack
demo:
	docker compose -f docker-compose.demo.yml up --build

# Seed demo data (run after 'make demo' when MongoDB is ready)
seed:
	docker compose -f docker-compose.demo.yml run --rm seed

# Tear down demo stack and volumes
demo-down:
	docker compose -f docker-compose.demo.yml down -v

# Generate a Fernet encryption key
fernet-key:
	@python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# Build docker images
build:
	docker compose build
