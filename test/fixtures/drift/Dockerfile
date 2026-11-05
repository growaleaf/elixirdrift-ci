FROM elixir:1.14-otp-25-slim
WORKDIR /app
COPY . .
RUN mix deps.get && mix compile
