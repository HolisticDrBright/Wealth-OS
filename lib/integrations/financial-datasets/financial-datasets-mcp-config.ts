/**
 * Financial Datasets MCP server configuration.
 *
 * financial-datasets/mcp-server provides typed financial data (income statements,
 * balance sheets, cash flows, SEC filings, stock prices) via MCP protocol.
 * Second MCP source alongside Vibe-Trading.
 *
 * To start locally:
 *   npx @financial-datasets/mcp-server --port 8766
 *   (or set FINANCIAL_DATASETS_API_KEY for premium endpoints)
 *
 * Set FINANCIAL_DATASETS_MCP_URL in .env.local.
 */

export const FINANCIAL_DATASETS_MCP_CONFIG = {
  serverUrl: process.env.FINANCIAL_DATASETS_MCP_URL ?? 'http://localhost:8766',
  featureKey: 'financial_datasets_mcp',
  displayName: 'Financial Datasets MCP',
  githubUrl: 'https://github.com/financial-datasets/mcp-server',
  requiresApiKey: false,  // free tier available; premium requires FINANCIAL_DATASETS_API_KEY
} as const

export type FinancialDatasetsTool =
  | 'get_income_statements'
  | 'get_balance_sheets'
  | 'get_cash_flow_statements'
  | 'get_stock_prices'
  | 'get_sec_filings'
  | 'search_financial_data'
  | 'get_earnings_estimates'
  | 'get_company_facts'

export interface FinancialDatasetsToolManifest {
  name: FinancialDatasetsTool
  description: string
  requiresPremium: boolean
  usedByStrategies: string[]
}

export const FINANCIAL_DATASETS_TOOLS: FinancialDatasetsToolManifest[] = [
  {
    name: 'get_income_statements',
    description: 'Annual and quarterly income statements for any public company',
    requiresPremium: false,
    usedByStrategies: ['qvm_multifactor', 'dividend_aristocrat', 'pead', 'spinoff'],
  },
  {
    name: 'get_balance_sheets',
    description: 'Balance sheet data including assets, liabilities, and equity',
    requiresPremium: false,
    usedByStrategies: ['qvm_multifactor', 'merger_arb', 'spinoff'],
  },
  {
    name: 'get_cash_flow_statements',
    description: 'Operating, investing, and financing cash flows',
    requiresPremium: false,
    usedByStrategies: ['qvm_multifactor', 'dividend_aristocrat'],
  },
  {
    name: 'get_stock_prices',
    description: 'Historical OHLCV data for US equities',
    requiresPremium: false,
    usedByStrategies: ['quant_momentum', 'vcp_minervini', 'pead'],
  },
  {
    name: 'get_sec_filings',
    description: 'SEC EDGAR filings: 10-K, 10-Q, 8-K, DEF 14A',
    requiresPremium: false,
    usedByStrategies: ['pead', 'spinoff', 'merger_arb'],
  },
  {
    name: 'search_financial_data',
    description: 'Full-text search across SEC filings and financial reports',
    requiresPremium: true,
    usedByStrategies: ['pead', 'spinoff'],
  },
  {
    name: 'get_earnings_estimates',
    description: 'Analyst consensus EPS and revenue estimates',
    requiresPremium: true,
    usedByStrategies: ['pead'],
  },
  {
    name: 'get_company_facts',
    description: 'Company metadata: employees, SIC code, exchange, description',
    requiresPremium: false,
    usedByStrategies: ['merger_arb', 'spinoff', 'dividend_aristocrat'],
  },
]
