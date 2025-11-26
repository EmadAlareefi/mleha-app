#!/bin/bash

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Testing Salla API Connection"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test 1: Check if merchant exists in database
echo "1️⃣  Checking merchant in database..."
MERCHANT_ID=$(psql $DATABASE_URL -t -c "SELECT \"merchantId\" FROM \"SallaAuth\" LIMIT 1;" 2>/dev/null | xargs)

if [ -z "$MERCHANT_ID" ]; then
  echo "❌ No merchant found in SallaAuth table"
  echo ""
  echo "💡 You need to authenticate with Salla first."
  echo "   Visit your Salla OAuth callback URL to get tokens."
  exit 1
else
  echo "✅ Merchant found: $MERCHANT_ID"
fi

echo ""

# Test 2: Check token expiry
echo "2️⃣  Checking token expiry..."
EXPIRES_AT=$(psql $DATABASE_URL -t -c "SELECT \"expiresAt\" FROM \"SallaAuth\" WHERE \"merchantId\" = '$MERCHANT_ID';" 2>/dev/null | xargs)
CURRENT_TIME=$(date -u +"%Y-%m-%d %H:%M:%S")

echo "   Token expires: $EXPIRES_AT"
echo "   Current time:  $CURRENT_TIME"

if [[ "$EXPIRES_AT" < "$CURRENT_TIME" ]]; then
  echo "⚠️  Token is EXPIRED - needs refresh"
else
  echo "✅ Token is still valid"
fi

echo ""

# Test 3: Try to fetch orders (simpler endpoint)
echo "3️⃣  Testing Salla API with /orders endpoint..."
response=$(curl -s -X GET "http://localhost:3000/api/salla/sync-invoices?merchantId=$MERCHANT_ID&perPage=1")

if echo "$response" | grep -q '"success":true'; then
  echo "✅ Sync endpoint is working"
  echo ""
  echo "📊 Response preview:"
  echo "$response" | head -c 500
else
  echo "❌ Sync failed"
  echo ""
  echo "📋 Full response:"
  echo "$response"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
