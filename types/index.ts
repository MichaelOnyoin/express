export type Item = {
  item_id: string;
  item_name: string;
  item_description: string;
  brand: string;
  manufacturer_address: {
    street: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
  };
  prices: {
    full_price: number;
    sale_price: number;
  };
  categories: string[];
  user_reviews: {
    review_date: string;
    rating: number;
    comment: string;
  }[];
  notes: string;
};