#!/bin/bash

# Print colorful status messages
print_status() {
    echo -e "\e[1;34m==>\e[0m \e[1m$1\e[0m"
}

print_success() {
    echo -e "\e[1;32m==>\e[0m \e[1m$1\e[0m"
}

print_error() {
    echo -e "\e[1;31m==>\e[0m \e[1m$1\e[0m"
}

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm first."
    exit 1
fi

# Print Node.js and npm versions
print_status "Using Node.js $(node -v) and npm $(npm -v)"

# Install root dependencies
print_status "Installing root dependencies..."
npm install

# Install server dependencies
print_status "Installing server dependencies..."
cd server
npm install
cd ..

# Install client dependencies
print_status "Installing client dependencies..."
cd packages/client
npm install
cd ../..

print_success "All dependencies have been installed successfully!"
print_status "You can now start the applications:"
echo "1. Start the server: cd server && npm run start:server1"
echo "2. Start the client: cd packages/client && npm run dev" 