const writeAuditLog = async (
  db,
  {
    actorUserId,
    action,
    entityType,
    entityId,
    previousValue = null,
    newValue = null,
    metadata = null,
  }
) => {
  try {
    await db('data_quality_audit_logs').insert({
      actor_user_id: actorUserId || null,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      previous_value: previousValue ? JSON.stringify(previousValue) : null,
      new_value: newValue ? JSON.stringify(newValue) : null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  } catch (error) {
    if (error?.code === '42P01' || error?.code === 'SQLITE_ERROR') {
      console.warn('[AUDIT] data_quality_audit_logs table unavailable; skipping audit log.');
      return;
    }
    throw error;
  }
};

module.exports = {
  writeAuditLog,
};
