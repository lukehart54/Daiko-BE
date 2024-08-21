import dotenv from "dotenv";
import app from "./app";
import util from "util";
import cors from "cors";
import bodyParser from "body-parser";
import pool from "./db"; // Import the PostgreSQL connection
import { getAccessTokenByInstitution } from "./dbUtils";
dotenv.config();

import {
  Configuration,
  PlaidEnvironments,
  PlaidApi,
  Products,
  CountryCode,
  TransactionsGetRequest,
} from "plaid";
import { Pool } from "pg";

const PORT = process.env.PORT || 5000;

const defaultProducts = [Products.Transactions];
const PLAID_ENV = process.env.PLAID_ENV || "sandbox";
let PUBLIC_TOKEN = "";
let ITEM_ID = null;

const PLAID_PRODUCTS = (process.env.PLAID_PRODUCTS || defaultProducts.join(","))
  .split(",")
  .map((product) => {
    const validProduct = Object.values(Products).includes(product as Products);
    if (validProduct) {
      return product as Products;
    } else {
      throw new Error(`Invalid product: ${product}`);
    }
  });

const defaultCountryCodes = [CountryCode.Us];

const PLAID_COUNTRY_CODES = (
  process.env.PLAID_COUNTRY_CODES || defaultCountryCodes.join(",")
)
  .split(",")
  .map((code) => {
    const validCode = Object.values(CountryCode).includes(code as CountryCode);
    if (validCode) {
      return code as CountryCode;
    } else {
      throw new Error(`Invalid country code: ${code}`);
    }
  });

const PLAID_REDIRECT_URI = process.env.PLAID_REDIRECT_URI || "";
const PLAID_ANDROID_PACKAGE_NAME = process.env.PLAID_ANDROID_PACKAGE_NAME || "";

const prettyPrintResponse = (response: any) => {
  console.log(util.inspect(response.data, { colors: true, depth: 4 }));
};

app.use(bodyParser.json());
app.use(cors());

// Connect to PostgreSQL database when the server starts
pool
  .connect()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((err: any) => {
    console.error("Failed to connect to the database", err);
    process.exit(-1);
  });

const configuration = new Configuration({
  basePath: PlaidEnvironments[PLAID_ENV],
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID,
      "PLAID-SECRET": process.env.PLAID_SECRET,
    },
  },
});

const client = new PlaidApi(configuration);

// Exchange token flow - exchange a Link public_token for
// an API access_token
// https://plaid.com/docs/#exchange-token-flow
app.post("/api/set_access_token", async (req, res, next) => {
  const { public_token, institution } = req.body;

  try {
    const tokenResponse = await client.itemPublicTokenExchange({
      public_token: public_token,
    });
    prettyPrintResponse(tokenResponse);

    const ACCESS_TOKEN = tokenResponse.data.access_token;
    const ITEM_ID = tokenResponse.data.item_id;
    const REQUEST_ID = tokenResponse.data.request_id;
    const EXPIRATION_DATE = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now

    // Insert or update the token data into the PostgreSQL database
    await pool.query(
      `INSERT INTO internal_data.access_tokens (access_token, item_id, request_id, expiration_date, institution) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (institution) 
       DO UPDATE SET 
         access_token = EXCLUDED.access_token, 
         item_id = EXCLUDED.item_id, 
         request_id = EXCLUDED.request_id, 
         expiration_date = EXCLUDED.expiration_date`,
      [ACCESS_TOKEN, ITEM_ID, REQUEST_ID, EXPIRATION_DATE, institution]
    );

    res.json({ access_token: ACCESS_TOKEN, item_id: ITEM_ID, error: null });
  } catch (error) {
    next(error);
  }
});

app.get("/api/create_link_token", function (request, response, next) {
  Promise.resolve()
    .then(async function () {
      const configs = {
        user: {
          // This should correspond to a unique id for the current user.
          client_user_id: "user-id",
        },
        client_name: "Daiko",
        products: PLAID_PRODUCTS,
        country_codes: PLAID_COUNTRY_CODES,
        language: "en",
        redirect_uri: PLAID_REDIRECT_URI,
      };

      if (PLAID_REDIRECT_URI !== "") {
        configs.redirect_uri = PLAID_REDIRECT_URI;
      }
      console.log(configs);

      const createTokenResponse = await client.linkTokenCreate(configs);
      prettyPrintResponse(createTokenResponse);
      response.json(createTokenResponse.data);
    })
    .catch(next);
});

app.get("/api/auth", async (req, res, next) => {
  const institution = req.query.institution;

  if (!institution) {
    return res.status(400).json({ error: "Institution name is required" });
  }

  try {
    const accessToken = await getAccessTokenByInstitution(
      pool as Pool,
      institution as string
    );

    if (!accessToken) {
      return res.status(404).json({
        error: "Access token not found for the specified institution",
      });
    }

    const authResponse = await client.authGet({
      access_token: accessToken,
    });

    prettyPrintResponse(authResponse);
    res.json(authResponse.data);
  } catch (error) {
    next(error);
  }
});

// Retrieve Transactions for an Item
// https://plaid.com/docs/#transactions
app.get("/api/transactions", async (req, res, next) => {
  const { institution, start_date, end_date } = req.query;

  if (!institution || !start_date || !end_date) {
    return res
      .status(400)
      .json({ error: "Institution, start_date, and end_date are required" });
  }

  try {
    // Retrieve the access token from the database
    const accessToken = await getAccessTokenByInstitution(
      pool,
      institution as string
    );

    if (!accessToken) {
      return res.status(404).json({
        error: "Access token not found for the specified institution",
      });
    }

    const transactionsRequest: TransactionsGetRequest = {
      access_token: accessToken,
      start_date: start_date as string,
      end_date: end_date as string,
    };

    const transactionsResponse = await client.transactionsGet(
      transactionsRequest
    );
    let transactions = transactionsResponse.data.transactions;
    const totalTransactions = transactionsResponse.data.total_transactions;

    // Fetch remaining transactions in paginated requests
    while (transactions.length < totalTransactions) {
      const paginatedRequest: TransactionsGetRequest = {
        access_token: accessToken,
        start_date: start_date as string,
        end_date: end_date as string,
        options: {
          offset: transactions.length,
        },
      };

      const paginatedResponse = await client.transactionsGet(paginatedRequest);
      transactions = transactions.concat(paginatedResponse.data.transactions);
    }

    // Return the transactions in the response
    res.json({ transactions });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    next(error); // Pass the error to the next middleware for handling
  }
});
