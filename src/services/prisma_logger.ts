// src/services/prisma_logger.ts - Prisma slow query logging
import { PrismaClient } from '@prisma/client';
import { incrementSlowQueries } from './metrics.js';

const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || '300');

// Create Prisma client with logging configuration
export const prismaWithLogging = new PrismaClient({
  log: [
    {
      emit: 'event',
      level: 'query',
    },
    {
      emit: 'event', 
      level: 'info',
    },
    {
      emit: 'event',
      level: 'warn',
    },
    {
      emit: 'event',
      level: 'error',
    },
  ],
});

// Track query performance and log slow queries
prismaWithLogging.$on('query', (e) => {
  const duration = e.duration;
  
  if (duration >= SLOW_QUERY_THRESHOLD_MS) {
    incrementSlowQueries();
    
    // Trim SQL for logging (remove excessive whitespace and limit length)
    const trimmedSql = e.query
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
    
    console.log(JSON.stringify({
      type: 'slow_query',
      timestamp: new Date().toISOString(),
      duration_ms: duration,
      operation: extractOperationName(e.query),
      sql: trimmedSql,
      params: e.params
    }));
  }
});

// Log Prisma info, warn, and error events
prismaWithLogging.$on('info', (e) => {
  console.log(JSON.stringify({
    type: 'prisma_info',
    timestamp: new Date().toISOString(),
    message: e.message
  }));
});

prismaWithLogging.$on('warn', (e) => {
  console.warn(JSON.stringify({
    type: 'prisma_warn',
    timestamp: new Date().toISOString(),
    message: e.message
  }));
});

prismaWithLogging.$on('error', (e) => {
  console.error(JSON.stringify({
    type: 'prisma_error',
    timestamp: new Date().toISOString(),
    message: e.message
  }));
});

// Extract operation name from SQL query for tagging
function extractOperationName(query: string): string {
  const sql = query.toLowerCase().trim();
  
  // Common patterns for operation identification
  if (sql.startsWith('select')) {
    if (sql.includes('from "tip"')) return 'TIP_READ';
    if (sql.includes('from "grouptip"')) return 'GROUP_TIP_READ';
    if (sql.includes('from "grouptipclaim"')) return 'CLAIM_READ';
    if (sql.includes('from "userbalance"')) return 'BALANCE_READ';
    if (sql.includes('from "user"')) return 'USER_READ';
    if (sql.includes('from "token"')) return 'TOKEN_READ';
    if (sql.includes('from "transaction"')) return 'TRANSACTION_READ';
    return 'SELECT_QUERY';
  }
  
  if (sql.startsWith('insert')) {
    if (sql.includes('into "tip"')) return 'TIP_CREATE';
    if (sql.includes('into "grouptip"')) return 'GROUP_TIP_CREATE';
    if (sql.includes('into "grouptipclaim"')) return 'CLAIM_CREATE';
    if (sql.includes('into "userbalance"')) return 'BALANCE_CREATE';
    if (sql.includes('into "user"')) return 'USER_CREATE';
    if (sql.includes('into "transaction"')) return 'TRANSACTION_CREATE';
    return 'INSERT_QUERY';
  }
  
  if (sql.startsWith('update')) {
    if (sql.includes('"tip"')) return 'TIP_UPDATE';
    if (sql.includes('"grouptip"')) return 'GROUP_TIP_UPDATE';
    if (sql.includes('"grouptipclaim"')) return 'CLAIM_UPDATE';
    if (sql.includes('"userbalance"')) return 'BALANCE_UPDATE';
    if (sql.includes('"user"')) return 'USER_UPDATE';
    return 'UPDATE_QUERY';
  }
  
  if (sql.startsWith('delete')) {
    if (sql.includes('from "tip"')) return 'TIP_DELETE';
    if (sql.includes('from "grouptip"')) return 'GROUP_TIP_DELETE';
    if (sql.includes('from "grouptipclaim"')) return 'CLAIM_DELETE';
    if (sql.includes('from "userbalance"')) return 'BALANCE_DELETE';
    return 'DELETE_QUERY';
  }
  
  // Raw queries or complex operations
  if (sql.includes('date(')) return 'DATE_AGGREGATION';
  if (sql.includes('count(') || sql.includes('sum(') || sql.includes('avg(')) return 'AGGREGATION_QUERY';
  if (sql.includes('group by')) return 'GROUP_BY_QUERY';
  if (sql.includes('order by')) return 'SORTED_QUERY';
  
  return 'UNKNOWN_QUERY';
}

// Wrapper function to tag operations explicitly in application code
export function taggedPrismaOperation<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const startTime = Date.now();
  
  return operation()
    .then(result => {
      const duration = Date.now() - startTime;
      
      if (duration >= SLOW_QUERY_THRESHOLD_MS) {
        console.log(JSON.stringify({
          type: 'slow_operation',
          timestamp: new Date().toISOString(),
          duration_ms: duration,
          operation: operationName
        }));
      }
      
      return result;
    })
    .catch(error => {
      const duration = Date.now() - startTime;
      
      console.error(JSON.stringify({
        type: 'operation_error',
        timestamp: new Date().toISOString(),
        duration_ms: duration,
        operation: operationName,
        error: error instanceof Error ? error.message : String(error)
      }));
      
      throw error;
    });
}

// Health check query with timeout
export async function healthCheckQuery(timeoutMs: number = 200): Promise<boolean> {
  try {
    const result = await Promise.race([
      prismaWithLogging.$queryRaw`SELECT 1 as health_check`,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Health check timeout')), timeoutMs)
      )
    ]);
    
    return Array.isArray(result) && result.length > 0;
  } catch (error) {
    console.error(JSON.stringify({
      type: 'health_check_error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    }));
    return false;
  }
}