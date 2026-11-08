import React from 'react';
import { Navigate } from 'react-router-dom';

export default function OnboardingWizard() {
  return <Navigate to="/settings?tab=balances" replace />;
}
