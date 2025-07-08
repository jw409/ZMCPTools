#!/bin/bash

# ClaudeMcpTools TypeScript Installation Script
# Provides the same rich installation experience as the Python version

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

# Helper functions
log() {
    echo -e "${WHITE}$1${NC}"
}

log_step() {
    echo -e "${BLUE}$1${NC} $2"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Banner
echo -e "${BOLD}${BLUE}"
cat << 'EOF'
╭─────────────────────────────────────────╮
│ 🚀 ClaudeMcpTools TypeScript Installer │
│ Enhanced MCP Tools for Claude Code      │
╰─────────────────────────────────────────╯
EOF
echo -e "${NC}"

# Check if we're in the right directory
if [[ ! -f "package.json" ]] || [[ ! -f "tsconfig.json" ]]; then
    log_error "Please run this script from the ClaudeMcpTools project root directory"
    exit 1
fi

# Check prerequisites
log_step "📋" "Checking prerequisites..."

check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo "false"
    else
        echo "true"
    fi
}

missing=()

# Check Node.js version
if [[ $(check_command "node") == "false" ]]; then
    missing+=("Node.js 18+ (https://nodejs.org/)")
else
    node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ $node_version -lt 18 ]]; then
        missing+=("Node.js 18+ (current: $(node -v))")
    fi
fi

# Check PNPM
if [[ $(check_command "pnpm") == "false" ]]; then
    missing+=("PNPM (npm install -g pnpm)")
fi

# Check Claude CLI
if [[ $(check_command "claude") == "false" ]]; then
    missing+=("Claude CLI (https://docs.anthropic.com/en/docs/claude-code)")
fi

if [[ ${#missing[@]} -gt 0 ]]; then
    log_error "Missing prerequisites:"
    for item in "${missing[@]}"; do
        echo -e "   ${RED}• $item${NC}"
    done
    exit 1
fi

log_success "All prerequisites found"

# Installation options
GLOBAL_ONLY=false
PROJECT_ONLY=false
YES=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --global-only)
            GLOBAL_ONLY=true
            shift
            ;;
        --project-only)
            PROJECT_ONLY=true
            shift
            ;;
        -y|--yes)
            YES=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --global-only    Global installation only, skip project setup"
            echo "  --project-only   Project setup only, skip global installation"
            echo "  -y, --yes        Accept all defaults, skip prompts"
            echo "  -h, --help       Show this help message"
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Confirmation prompt (unless --yes)
if [[ "$YES" != "true" ]]; then
    echo ""
    log "📋 ${BOLD}Installation Summary:${NC}"
    echo "   Location: Global npm link + ~/.mcptools/data/"
    if [[ "$GLOBAL_ONLY" == "true" ]]; then
        echo "   Type: Global installation only"
    elif [[ "$PROJECT_ONLY" == "true" ]]; then
        echo "   Type: Project setup only"
    else
        echo "   Type: Full setup (global + project)"
    fi
    echo ""
    
    read -p "Continue with installation? (Y/n): " -r
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        log_error "Installation cancelled"
        exit 0
    fi
fi

echo ""

# Step 1: Install dependencies and build
if [[ "$PROJECT_ONLY" != "true" ]]; then
    log_step "📦" "Installing dependencies..."
    if ! pnpm install --silent; then
        log_error "Failed to install dependencies"
        exit 1
    fi
    log_success "Dependencies installed"

    log_step "🔧" "Building TypeScript..."
    if ! pnpm build --silent; then
        log_error "Failed to build project"
        exit 1
    fi
    log_success "Build complete"

    # Step 2: Global linking
    log_step "🌐" "Linking globally..."
    if ! npm link --silent; then
        log_error "Failed to link globally"
        exit 1
    fi
    log_success "Global link created"
fi

# Step 3: Run the comprehensive installer
log_step "⚙️" "Running TypeScript installation script..."

# Build arguments for the installer
installer_args=("install")
if [[ "$GLOBAL_ONLY" == "true" ]]; then
    installer_args+=("--global-only")
fi

# Run the TypeScript installer using tsx (hot execution)
if ! npx tsx src/installer/index.ts "${installer_args[@]}"; then
    log_error "Installation script failed"
    exit 1
fi

# Final success message
echo ""
echo -e "${GREEN}${BOLD}"
cat << 'EOF'
╭─────────────────── 🎉 Success ───────────────────╮
│ ✅ ClaudeMcpTools TypeScript Installation Complete │
╰───────────────────────────────────────────────────╯
EOF
echo -e "${NC}"

echo -e "${WHITE}🚀 ${BOLD}Next steps:${NC}"
echo -e "   ${CYAN}1. Restart Claude Code${NC}"
echo -e "   ${CYAN}2. Use /mcp to see available tools${NC}"
echo -e "   ${CYAN}3. Try: orchestrate_objective() for workflows${NC}"
echo -e "   ${CYAN}4. Check: ./CLAUDE.md for TypeScript examples${NC}"
echo ""
echo -e "${YELLOW}💡 Quick commands:${NC}"
echo -e "   ${DIM}claude-mcp-tools status      # Check installation${NC}"
echo -e "   ${DIM}claude-mcp-tools help        # Show all commands${NC}"
echo -e "   ${DIM}claude-mcp-tools agent list  # List agents${NC}"
echo ""