#!/bin/bash

# Quick test script for Playwright server
# Run this to validate server is working correctly

echo "🧪 Testing Playwright Server..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Health Check
echo "Test 1: Health Check Endpoint"
echo "==============================="
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:3000/api/health 2>/dev/null)
HTTP_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$HEALTH_RESPONSE" | head -n-1)

if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Server is running"
    echo "Response: $RESPONSE_BODY"
else
    echo -e "${RED}✗ FAIL${NC} - Server not responding (HTTP $HTTP_CODE)"
    echo -e "${YELLOW}Make sure server is running: cd prototype && npm start${NC}"
    exit 1
fi
echo ""

# Test 2: CORS Headers
echo "Test 2: CORS Headers"
echo "===================="
CORS_HEADERS=$(curl -s -I http://localhost:3000/api/health | grep -i "access-control")

if [ -n "$CORS_HEADERS" ]; then
    echo -e "${GREEN}✓ PASS${NC} - CORS headers present"
    echo "$CORS_HEADERS"
else
    echo -e "${RED}✗ FAIL${NC} - CORS headers missing"
fi
echo ""

# Test 3: Cache Endpoint (Simple Test)
echo "Test 3: Cache Endpoint"
echo "======================"
echo "Caching example.com (this may take 10-30 seconds)..."

CACHE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3000/api/cache \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","maxDepth":0}' 2>/dev/null)

CACHE_HTTP_CODE=$(echo "$CACHE_RESPONSE" | tail -n1)
CACHE_BODY=$(echo "$CACHE_RESPONSE" | head -n-1)

if [ "$CACHE_HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Cache endpoint works"
    CACHE_HASH=$(echo "$CACHE_BODY" | grep -o '"cacheHash":"[^"]*"' | cut -d'"' -f4)
    echo "Cache Hash: $CACHE_HASH"
    
    # Test 4: Content Endpoint
    if [ -n "$CACHE_HASH" ]; then
        echo ""
        echo "Test 4: Content Endpoint"
        echo "========================"
        CONTENT_RESPONSE=$(curl -s -w "\n%{http_code}" http://localhost:3000/api/content/$CACHE_HASH 2>/dev/null)
        CONTENT_HTTP_CODE=$(echo "$CONTENT_RESPONSE" | tail -n1)
        
        if [ "$CONTENT_HTTP_CODE" == "200" ]; then
            echo -e "${GREEN}✓ PASS${NC} - Content endpoint works"
            echo "Content retrieved successfully"
        else
            echo -e "${RED}✗ FAIL${NC} - Content endpoint failed (HTTP $CONTENT_HTTP_CODE)"
        fi
    fi
else
    echo -e "${RED}✗ FAIL${NC} - Cache endpoint failed (HTTP $CACHE_HTTP_CODE)"
    echo "Response: $CACHE_BODY"
fi
echo ""

# Summary
echo "=============================="
echo "📊 Test Summary"
echo "=============================="
echo "All basic server tests completed."
echo ""
echo "Next steps:"
echo "1. Load the extension in Chrome"
echo "2. Set PLAYWRIGHT_ENABLED: true in config.js"
echo "3. Reload the extension"
echo "4. Open popup and check for green status indicator"
echo "5. Try caching a page"
echo ""
echo "For detailed testing, see TESTING_CHECKLIST.md"
