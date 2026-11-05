FROM elixir:1.17.3-otp-27-alpine
WORKDIR /app
COPY . .
RUN mix deps.get && mix compile
