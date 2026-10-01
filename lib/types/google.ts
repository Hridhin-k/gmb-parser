// ---------------------------------------------------------------------------
// Google Business Profile API response types
// https://developers.google.com/my-business/reference/accountmanagement/rest
// https://developers.google.com/my-business/reference/businessinformation/rest
// ---------------------------------------------------------------------------

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  token_type: string;
  scope: string;
}

// mybusinessaccountmanagement/v1/accounts
export interface GoogleBusinessAccount {
  name: string;           // "accounts/{accountId}"
  accountName: string;    // Human-readable name
  type: string;           // PERSONAL, LOCATION_GROUP, USER_GROUP, ORGANIZATION
  role: string;           // OWNER, CO_OWNER, MANAGER, COMMUNITY_MANAGER
  state: {
    status: string;       // VERIFIED, UNVERIFIED, VERIFICATION_REQUESTED
  };
  verificationState?: string;
}

// mybusinessbusinessinformation/v1 location
export interface GoogleBusinessLocation {
  name: string;           // "accounts/{accountId}/locations/{locationId}"
  title: string;
  storeCode?: string;
  storefrontAddress?: {
    addressLines: string[];
    locality: string;
    administrativeArea: string;
    postalCode: string;
    regionCode: string;
  };
  phoneNumbers?: {
    primaryPhone?: string;
    additionalPhones?: string[];
  };
  websiteUri?: string;
  metadata?: {
    placeId?: string;
    mapsUri?: string;
    newReviewUri?: string;
    hasPendingEdits?: boolean;
    hasGoogleUpdated?: boolean;
    canHaveFoodMenus?: boolean;
  };
}

export interface GoogleLocationsListResponse {
  locations?: GoogleBusinessLocation[];
  nextPageToken?: string;
  totalSize?: number;
}

export interface GoogleAccountsListResponse {
  accounts?: GoogleBusinessAccount[];
  nextPageToken?: string;
}

// Reviews (mybusiness v4)
export interface GoogleReview {
  name: string;
  reviewId: string;
  reviewer: {
    displayName: string;
    profilePhotoUrl?: string;
    isAnonymous?: boolean;
  };
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  comment?: string;
  createTime: string;
  updateTime?: string;
  reviewReply?: {
    comment: string;
    updateTime: string;
  };
}

export interface GoogleReviewsResponse {
  reviews: GoogleReview[];
  totalReviewCount: number;
  averageRating: number;
  nextPageToken?: string;
}

// Normalized forms stored in application DB
export interface NormalizedGoogleAccount {
  googleAccountName: string;    // "accounts/{accountId}"
  accountDisplayName: string;
  accountType: string;
  verificationState: string | null;
}

export interface NormalizedGoogleLocation {
  googleLocationName: string;   // "accounts/{a}/locations/{l}"
  locationTitle: string;
  storeCode: string | null;
  addressFormatted: string | null;
  primaryPhone: string | null;
  websiteUri: string | null;
  placeId: string | null;
}

// Error shape from Google APIs
export interface GoogleApiErrorBody {
  error?: {
    code: number;
    message: string;
    status: string;
    details?: Array<{ type: string; reason?: string }>;
  };
}
