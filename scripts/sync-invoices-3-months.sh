#!/bin/bash

# Sync Salla invoices from the past 3 months
# Usage: ./scripts/sync-invoices-3-months.sh [MERCHANT_ID]

# Calculate dates
END_DATE=$(date +%Y-%m-%d)
START_DATE=$(date -d "3 months ago" +%Y-%m-%d)

# API URL
API_URL="http://localhost:3000/api/salla/sync-invoices"

# Optional merchant ID
MERCHANT_ID=${1:-}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Syncing Salla Invoices - Past 3 Months"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📅 Date Range:"
echo "   From: $START_DATE"
echo "   To:   $END_DATE"
echo ""

if [ -n "$MERCHANT_ID" ]; then
  echo "🏪 Merchant: $MERCHANT_ID"
  URL="$API_URL?merchantId=$MERCHANT_ID&startDate=$START_DATE&endDate=$END_DATE"
else
  echo "🏪 Merchant: All merchants"
  URL="$API_URL?startDate=$START_DATE&endDate=$END_DATE"
fi

echo ""
echo "🚀 Starting sync..."
echo ""

# Make the request (no auth required for local use)
response=$(curl -s -X POST "$URL" \
  -H "Content-Type: application/json")

# Check if response contains success
if echo "$response" | grep -q '"success":true'; then
  echo "✅ Sync completed successfully!"
  echo ""
  echo "📊 Results:"
  # Pretty print JSON if jq is available, otherwise just print response
  if command -v jq &> /dev/null; then
    echo "$response" | jq '.'
  else
    echo "$response"
  fi
else
  echo "❌ Sync failed!"
  echo ""
  echo "Error details:"
  # Pretty print JSON if jq is available, otherwise just print response
  if command -v jq &> /dev/null; then
    echo "$response" | jq '.'
  else
    echo "$response"
  fi
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✨ Done! Visit http://localhost:3000/invoices to view"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
