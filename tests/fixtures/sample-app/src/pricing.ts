import type { ShoppingCart } from './cart.js';

export interface PricingSummary {
  readonly subtotal: number;
  readonly discountAmount: number;
  readonly taxAmount: number;
  readonly total: number;
}

export class PricingEngine {
  private readonly defaultTaxRate = 0.08;

  calculateTotal(cart: ShoppingCart): PricingSummary {
    const subtotal = cart.items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    let discountAmount = 0;
    if (subtotal >= 100) {
      discountAmount = subtotal * 0.10; // FIXED 10% discount
    }

    const taxableAmount = subtotal - discountAmount;
    const taxRate = cart.isTaxExempt ? 0 : this.defaultTaxRate; // FIXED tax exemption check
    const taxAmount = taxableAmount * taxRate;

    return { subtotal, discountAmount, taxAmount, total: taxableAmount + taxAmount };
  }
}
