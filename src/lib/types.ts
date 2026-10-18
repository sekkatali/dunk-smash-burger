export type Category = {
  id: string
  name: string
  description: string | null
  position: number
  active: boolean
}

export type Product = {
  id: string
  category_id: string | null
  name: string
  description: string | null
  price: number
  compare_at_price: number | null
  image_url: string | null
  badge: string | null
  active: boolean
  available: boolean
  featured: boolean
  position: number
}

export type OptionItem = {
  id: string
  group_id: string
  name: string
  price: number
  available: boolean
  position: number
}

export type OptionGroup = {
  id: string
  name: string
  internal_name: string | null
  min_select: number
  max_select: number
  position: number
}

export type ProductOptionGroup = {
  product_id: string
  group_id: string
  position: number
}

export type GroupWithOptions = OptionGroup & { options: OptionItem[] }

export type LoyaltyOption = { type: 'credit' | 'category'; label: string; amount?: number; category?: string }

export type Zone = { name: string; fee: number | null; min_order: number | null; active: boolean }

export type DayHours = { day: number; open: string; close: string; closed: boolean }

export type Settings = {
  restaurant: {
    name: string
    tagline: string
    phone: string
    whatsapp: string
    email: string
    address: string
    city: string
    instagram: string
    tiktok: string
    logo_url: string
  }
  ordering: {
    accept_orders: boolean
    delivery_enabled: boolean
    pickup_enabled: boolean
    min_order: number
    delivery_fee: number
    free_delivery_threshold: number
    prep_time_min: number
    delivery_time_min: number
    closed_message: string
    asap_enabled: boolean
    scheduling_enabled: boolean
    slot_minutes: number
    schedule_days_ahead: number
    disabled_slots: string[]
    require_account: boolean
    first_cash_confirmation: boolean
    pickup_min_order: number
  }
  delivery: {
    mode: 'distance' | 'zones'
    max_km: number
    min_order: number
    free_threshold: number
    tiers: { up_to_km: number; fee: number }[]
  }
  loyalty: {
    enabled: boolean
    stamps_required: number
    min_order: number
    progress_expiry_days: number
    reward_expiry_days: number
    rewards: LoyaltyOption[]
  }
  hours: DayHours[]
  zones: Zone[]
  payments: {
    cash: boolean
    card_on_delivery: boolean
    cmi: boolean
    cmi_client_id: string
    cmi_test_mode: boolean
  }
  marketing: {
    announcement_enabled: boolean
    announcement_text: string
    meta_pixel_id: string
    ga4_id: string
    tiktok_pixel_id: string
    upsell_product_ids: string[]
  }
  notifications: {
    sound: boolean
  }
}

export type OrderStatus =
  | 'pending_payment'
  | 'pending_confirmation'
  | 'new'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'delivering'
  | 'delivered'
  | 'failed'
  | 'cancelled'

export type PaymentMethod = 'cash' | 'card_on_delivery' | 'cmi'
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'

export type OrderItemOption = { id: string; group: string; name: string; price: number }

export type OrderItem = {
  id: string
  order_id: string
  product_id: string | null
  product_name: string
  unit_price: number
  quantity: number
  options: OrderItemOption[]
  note: string | null
  total: number
}

export type Order = {
  id: string
  number: number
  token: string
  status: OrderStatus
  type: 'delivery' | 'pickup'
  customer_name: string
  customer_phone: string
  customer_email: string | null
  address: string | null
  address_details: string | null
  zone: string | null
  notes: string | null
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  payment_ref: string | null
  subtotal: number
  delivery_fee: number
  discount: number
  total: number
  promo_code: string | null
  driver_id: string | null
  cash_settled: boolean
  cancel_reason: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  accepted_at: string | null
  ready_at: string | null
  delivering_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  customer_id: string | null
  scheduled_for: string | null
  pickup_code: string | null
  distance_km: number | null
  lat: number | null
  lng: number | null
  rating: number | null
  rating_comment: string | null
  reward_discount: number
  credit_used: number
  requires_confirmation: boolean
  confirmed_at: string | null
  failed_reason: string | null
  cash_collected: number | null
  order_items?: OrderItem[]
}

export type Driver = {
  id: string
  name: string
  phone: string | null
  vehicle: string | null
  plate: string | null
  status: 'available' | 'busy' | 'offline'
  active: boolean
  notes: string | null
  access_token: string
  created_at: string
}

export type PromoCode = {
  id: string
  code: string
  description: string | null
  type: 'percent' | 'fixed' | 'free_delivery'
  value: number
  min_order: number
  max_discount: number | null
  max_uses: number | null
  max_uses_per_customer: number | null
  uses: number
  first_order_only: boolean
  starts_at: string | null
  ends_at: string | null
  active: boolean
  created_at: string
  valid_days_after_signup: number | null
  requires_account: boolean
  order_types: string[] | null
  payment_methods: string[] | null
  budget: number | null
}

export type Customer = {
  user_id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  phone_verified: boolean
  email: string | null
  marketing_opt_in: boolean
  created_at: string
}

export type CustomerAddress = {
  id: string
  user_id: string
  label: string | null
  address: string
  details: string | null
  lat: number | null
  lng: number | null
  is_default: boolean
}
