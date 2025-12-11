'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import AppNavbar from '@/components/AppNavbar';

interface OrderUser {
  id: string;
  username: string;
  name: string;
  autoAssign: boolean;
  maxOrders: number;
}

interface OrderAssignment {
  id: string;
  orderId: string;
  orderNumber: string;
  orderData: any;
  status: string;
  assignedAt: string;
}

export default function OrderPrepPage() {
  const { data: session, status } = useSession();
  const role = (session?.user as any)?.role;
  const roles = ((session?.user as any)?.roles || [role]) as string[];
  const isOrdersUser = roles.includes('orders');
  const [user, setUser] = useState<OrderUser | null>(null);

  const [assignments, setAssignments] = useState<OrderAssignment[]>([]);
  const [currentOrder, setCurrentOrder] = useState<OrderAssignment | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [refreshingItems, setRefreshingItems] = useState(false);
  const [creatingShipment, setCreatingShipment] = useState(false);
  const [shipmentInfo, setShipmentInfo] = useState<{trackingNumber: string; courierName: string} | null>(null);

  // Load user from session
  useEffect(() => {
    if (session?.user && isOrdersUser) {
      const sessionUser = session.user as any;
      setUser({
        id: sessionUser.id,
        username: sessionUser.username,
        name: sessionUser.name,
        autoAssign: sessionUser.orderUserData?.autoAssign || false,
        maxOrders: sessionUser.orderUserData?.maxOrders || 50,
      });
    }
  }, [session, isOrdersUser]);

  useEffect(() => {
    if (user && user.autoAssign) {
      // Auto-assign orders when user logs in
      autoAssignOrders();
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadMyOrders();
    }
  }, [user]);

  // Reset shipment info when changing orders
  useEffect(() => {
    setShipmentInfo(null);
  }, [currentOrder?.id]);


  const autoAssignOrders = async () => {
    if (!user) return;

    try {
      // First validate existing orders
      await fetch('/api/order-assignments/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      // Then auto-assign new orders
      const response = await fetch('/api/order-assignments/auto-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      const data = await response.json();

      if (data.success && data.assigned > 0) {
        console.log(`${data.assigned} orders auto-assigned`);
        loadMyOrders();
      }
    } catch (error) {
      console.error('Auto-assign failed:', error);
    }
  };

  const loadMyOrders = async () => {
    if (!user) return;

    setLoadingOrders(true);
    try {
      // First, validate orders - remove any that are no longer in "طلب جديد" status
      await fetch('/api/order-assignments/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id }),
      });

      // Then load orders
      const response = await fetch(`/api/order-assignments/my-orders?userId=${user.id}`);
      const data = await response.json();

      if (data.success) {
        setAssignments(data.assignments);
        // Set first order as current if none selected
        if (!currentOrder && data.assignments.length > 0) {
          setCurrentOrder(data.assignments[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load orders:', error);
    } finally {
      setLoadingOrders(false);
    }
  };

  const handleStartPreparation = async () => {
    if (!currentOrder) return;

    try {
      const response = await fetch('/api/order-assignments/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: currentOrder.id,
          status: 'preparing',
          updateSalla: false, // Status already set to processing during assignment
        }),
      });

      const data = await response.json();

      if (data.success) {
        loadMyOrders();
      }
    } catch (error) {
      alert('فشل بدء التحضير');
    }
  };

  const handleCompleteOrder = async () => {
    if (!currentOrder) return;

    try {
      const response = await fetch('/api/order-assignments/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: currentOrder.id,
        }),
      });

      const data = await response.json();

      if (data.success) {
        // Clear current order
        setCurrentOrder(null);

        // Auto-assign a new order if autoAssign is enabled
        if (user?.autoAssign) {
          await autoAssignOrders();
        } else {
          loadMyOrders();
        }
      } else {
        const errorMsg = data.details ? `${data.error}\n\nتفاصيل: ${data.details}` : data.error;
        console.error('Complete order error:', data);
        alert(errorMsg || 'فشل إكمال الطلب');
      }
    } catch (error) {
      console.error('Complete order exception:', error);
      alert('فشل إكمال الطلب');
    }
  };

  const handleSkipOrder = () => {
    const nextOrder = assignments.find(a => a.id !== currentOrder?.id);
    setCurrentOrder(nextOrder || null);
  };

  const handleRefreshItems = async () => {
    if (!currentOrder) return;

    setRefreshingItems(true);
    try {
      const response = await fetch('/api/order-assignments/refresh-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: currentOrder.id }),
      });

      const data = await response.json();

      if (data.success) {
        // Reload orders to get the updated data
        await loadMyOrders();
        alert(`تم تحديث المنتجات بنجاح - عدد المنتجات: ${data.itemsCount}`);
      } else {
        alert(data.error || 'فشل تحديث المنتجات');
      }
    } catch (error) {
      alert('فشل تحديث المنتجات');
    } finally {
      setRefreshingItems(false);
    }
  };

  const handleCreateShipment = async () => {
    if (!currentOrder) return;

    setCreatingShipment(true);
    try {
      const response = await fetch('/api/salla/create-shipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignmentId: currentOrder.id }),
      });

      const data = await response.json();

      if (data.success) {
        setShipmentInfo({
          trackingNumber: data.data.trackingNumber,
          courierName: data.data.courierName,
        });
        alert(`✅ تم إنشاء الشحنة بنجاح!\n\nرقم التتبع: ${data.data.trackingNumber}\nشركة الشحن: ${data.data.courierName}`);
      } else {
        const errorMsg = data.details ? `${data.error}\n\nتفاصيل: ${data.details}` : data.error;
        alert(errorMsg || 'فشل إنشاء الشحنة');
      }
    } catch (error) {
      console.error('Create shipment exception:', error);
      alert('فشل إنشاء الشحنة');
    } finally {
      setCreatingShipment(false);
    }
  };

  // Show loading while checking session
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-lg">جاري التحميل...</p>
      </div>
    );
  }

  // If not authenticated or not an order user, show message
  if (!session || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">تحضير الطلبات</h1>
          <p className="text-gray-600 mb-6">يجب تسجيل الدخول كمستخدم طلبات للوصول إلى هذه الصفحة</p>
          <Button onClick={() => window.location.href = '/login'} className="w-full">
            تسجيل الدخول
          </Button>
        </Card>
      </div>
    );
  }

  if (!isOrdersUser) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 text-center">
        <Card className="p-8 max-w-md">
          <p className="text-lg font-semibold text-gray-700">
            ليس لديك صلاحية للوصول إلى لوحة تحضير الطلبات.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppNavbar title="تحضير الطلبات" subtitle={`مرحباً، ${user.name}`} />

      <div className="w-full">
        {/* Content */}
        <div className="px-4 md:px-6 py-6">
          {/* Stats */}
          {assignments.length > 0 && (
            <Card className="max-w-7xl mx-auto p-6 mb-6 text-center">
              <p className="text-gray-600 mb-2">الطلبات النشطة</p>
              <p className="text-4xl font-bold text-blue-600">{assignments.length}</p>
            </Card>
          )}

          {loadingOrders ? (
            <div className="max-w-7xl mx-auto text-center py-12">
              <p>جاري تحميل الطلبات...</p>
            </div>
          ) : !currentOrder ? (
            <Card className="max-w-7xl mx-auto p-8 md:p-12 text-center">
              <p className="text-xl text-gray-600 mb-4">لا توجد طلبات للتحضير</p>
              <Button onClick={autoAssignOrders}>تحديث الطلبات</Button>
            </Card>
          ) : (
            <div className="max-w-7xl mx-auto">
              {/* Order Header */}
              <Card className="p-4 md:p-6 mb-4 md:mb-6">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold">طلب #{currentOrder.orderNumber}</h2>
                  <p className="text-gray-600 mt-1">
                    {currentOrder.orderData?.customer?.first_name} {currentOrder.orderData?.customer?.last_name}
                  </p>
                  {currentOrder.orderData?.customer?.city && (
                    <p className="text-sm text-gray-500 mt-1">
                      📍 {currentOrder.orderData.customer.location && `${currentOrder.orderData.customer.location} - `}
                      {currentOrder.orderData.customer.city}
                    </p>
                  )}
                  {currentOrder.orderData?.notes && (
                    <p className="text-sm text-orange-600 mt-2 font-medium">
                      📝 ملاحظات: {currentOrder.orderData.notes}
                    </p>
                  )}
                </div>
              </Card>

              {/* Products and Options */}
              <div className="space-y-3 md:space-y-4">
                {/* Regular Products */}
                {currentOrder.orderData?.items && currentOrder.orderData.items.length > 0 ? (
                  <>
                    {currentOrder.orderData.items.map((item: any, idx: number) => (
                      <Card key={`item-${idx}`} className="p-4 md:p-6">
                        <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                        {/* Product Image */}
                        <div className="flex-shrink-0">
                          {(item.thumbnail || item.product_thumbnail || item.product?.thumbnail) ? (
                            <img
                              src={item.thumbnail || item.product_thumbnail || item.product?.thumbnail}
                              alt={item.name}
                              className="w-full md:w-40 md:h-40 object-contain rounded-lg border-2 border-gray-200 bg-white"
                            />
                          ) : (
                            <div className="w-full md:w-40 md:h-40 h-64 bg-gray-100 rounded-lg border-2 border-gray-200 flex items-center justify-center">
                              <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Product Details */}
                        <div className="flex-1 space-y-3">
                          <h3 className="text-2xl font-bold text-gray-900">{item.name}</h3>

                          {/* SKU and Quantity */}
                          <div className="flex flex-wrap gap-2">
                            {item.sku && (
                              <div className="inline-flex items-center gap-2 bg-blue-50 border-2 border-blue-500 px-4 py-3 rounded-lg">
                                <span className="text-sm font-semibold text-blue-700">SKU:</span>
                                <span className="text-xl font-bold text-blue-900">{item.sku}</span>
                              </div>
                            )}

                            <div className="inline-flex items-center gap-2 bg-green-50 border-2 border-green-500 px-4 py-3 rounded-lg">
                              <span className="text-sm font-semibold text-green-700">الكمية:</span>
                              <span className="text-xl font-bold text-green-900">×{item.quantity}</span>
                            </div>
                          </div>

                          {/* Product Options (Size, Color, etc.) */}
                          {item.options && item.options.length > 0 && (
                            <div className="space-y-2">
                              {item.options.map((option: any, optIdx: number) => (
                                <div key={optIdx} className="inline-flex items-center gap-2 bg-purple-50 border border-purple-300 px-3 py-2 rounded-lg mr-2">
                                  <span className="text-sm font-medium text-purple-700">{option.name}:</span>
                                  <span className="text-sm font-bold text-purple-900">{option.value?.name || option.value}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}

                    {/* Order Options (Gift wrapping, etc.) */}
                    {currentOrder.orderData?.options && currentOrder.orderData.options.length > 0 && (
                      <Card className="p-4 md:p-6 bg-amber-50 border-2 border-amber-300">
                        <h3 className="text-base md:text-lg font-bold text-amber-900 mb-3">خيارات إضافية:</h3>
                        <div className="space-y-2">
                          {currentOrder.orderData.options.map((option: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2">
                              <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                              <span className="text-sm md:text-base font-medium text-amber-900">{option.name}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    )}
                  </>
                ) : (
                  <Card className="p-6 md:p-8 text-center">
                    <p className="text-gray-500 mb-4">لا توجد منتجات في هذا الطلب</p>
                    <Button onClick={handleRefreshItems} disabled={refreshingItems} variant="outline">
                      {refreshingItems ? 'جاري التحديث...' : 'تحديث المنتجات'}
                    </Button>
                  </Card>
                )}
              </div>

              {/* Shipment Info Display */}
              {shipmentInfo && (
                <Card className="mt-6 p-4 bg-green-50 border-2 border-green-500">
                  <h3 className="text-lg font-bold text-green-900 mb-2">✅ تم إنشاء الشحنة</h3>
                  <div className="space-y-1">
                    <p className="text-sm text-green-800">
                      <strong>رقم التتبع:</strong> {shipmentInfo.trackingNumber}
                    </p>
                    <p className="text-sm text-green-800">
                      <strong>شركة الشحن:</strong> {shipmentInfo.courierName}
                    </p>
                  </div>
                </Card>
              )}

              {/* Action Buttons - Fixed at bottom */}
              <div className="mt-6 sticky bottom-0 bg-white border-t border-gray-200 p-4 -mx-4 md:-mx-6 shadow-lg">
                <div className="max-w-7xl mx-auto flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={handleCreateShipment}
                    disabled={creatingShipment || !!shipmentInfo}
                    className="w-full py-6 text-lg bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {creatingShipment ? 'جاري إنشاء الشحنة...' : shipmentInfo ? '✓ تم إنشاء الشحنة' : 'انشاء شحنة'}
                  </Button>
                  <Button
                    onClick={handleCompleteOrder}
                    className="w-full py-6 text-lg bg-green-600 hover:bg-green-700"
                  >
                    إنهاء الطلب
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
