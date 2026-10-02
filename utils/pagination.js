// Utility for parsing pagination parameters and formatting paginated responses.

function parsePagination(query = {}) {
  let page = 1;
  let limit = 10;

  if (query.page !== undefined) {
    if (Array.isArray(query.page)) {
      return { error: "Page must be a positive integer" };
    }
    const pageStr = typeof query.page === "string" ? query.page.trim() : String(query.page).trim();
    if (!/^\d+$/.test(pageStr) || parseInt(pageStr, 10) <= 0) {
      return { error: "Page must be a positive integer" };
    }
    page = parseInt(pageStr, 10);
  }

  if (query.limit !== undefined) {
    if (Array.isArray(query.limit)) {
      return { error: "Limit must be a positive integer" };
    }
    const limitStr = typeof query.limit === "string" ? query.limit.trim() : String(query.limit).trim();
    if (!/^\d+$/.test(limitStr) || parseInt(limitStr, 10) <= 0) {
      return { error: "Limit must be a positive integer" };
    }
    const limitNum = parseInt(limitStr, 10);
    if (limitNum > 100) {
      return { error: "Limit cannot exceed 100" };
    }
    limit = limitNum;
  }

  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function formatPaginatedResponse(rows, count, page, limit) {
  return {
    data: rows,
    pagination: {
      page,
      limit,
      total: count,
      totalPages: count === 0 ? 0 : Math.ceil(count / limit),
    },
  };
}

module.exports = { parsePagination, formatPaginatedResponse, };