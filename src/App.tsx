import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { SettingsProvider } from './lib/settings'
import { CartProvider } from './lib/cart'
import { PageLoader, ToastProvider } from './components/ui'
import { ShopLayout } from './shop/ShopLayout'
import { ShopMenuProvider } from './shop/menuContext'
import { MenuPage } from './shop/MenuPage'
import { CheckoutPage } from './shop/CheckoutPage'
import { OrderTrackingPage } from './shop/OrderTrackingPage'
import { LoginPage as CustomerLoginPage } from './shop/LoginPage'
import { AccountPage } from './shop/AccountPage'
import { CustomerProvider } from './lib/customer'

const AdminLayout = lazy(() => import('./admin/AdminLayout'))
const LoginPage = lazy(() => import('./admin/LoginPage'))
const OrdersPage = lazy(() => import('./admin/OrdersPage'))
const ProductsPage = lazy(() => import('./admin/ProductsPage'))
const DriversPage = lazy(() => import('./admin/DriversPage'))
const StatsPage = lazy(() => import('./admin/StatsPage'))
const MarketingPage = lazy(() => import('./admin/MarketingPage'))
const PaymentsPage = lazy(() => import('./admin/PaymentsPage'))
const SettingsPage = lazy(() => import('./admin/SettingsPage'))
const DriverPortal = lazy(() => import('./driver/DriverPortal'))

export default function App() {
  return (
    <ToastProvider>
      <SettingsProvider>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route
              element={
                <CustomerProvider>
                  <ShopMenuProvider>
                    <CartProvider>
                      <ShopLayout />
                    </CartProvider>
                  </ShopMenuProvider>
                </CustomerProvider>
              }
            >
              <Route index element={<MenuPage />} />
              <Route path="commande" element={<CheckoutPage />} />
              <Route path="suivi/:token" element={<OrderTrackingPage />} />
              <Route path="connexion" element={<CustomerLoginPage />} />
              <Route path="compte/:tab?" element={<AccountPage />} />
            </Route>

            <Route path="admin/login" element={<LoginPage />} />
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="commandes" replace />} />
              <Route path="commandes" element={<OrdersPage />} />
              <Route path="produits" element={<ProductsPage />} />
              <Route path="livreurs" element={<DriversPage />} />
              <Route path="statistiques" element={<StatsPage />} />
              <Route path="marketing" element={<MarketingPage />} />
              <Route path="paiement" element={<PaymentsPage />} />
              <Route path="parametres" element={<SettingsPage />} />
            </Route>

            <Route path="livreur/:token" element={<DriverPortal />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </SettingsProvider>
    </ToastProvider>
  )
}
