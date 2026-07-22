-- Module catalog + per-tier module unlocks, derived from the raw
-- .np-feat-list extraction of all 9 KAPA ONE product pages
-- (~/kapa-website/kapa-one-*.html) done earlier in this session.
--
-- CONSOLIDATION NOTE: mapping every single <li> bullet 1:1 to its own
-- module would have produced 150+ near-duplicate rows (e.g. an
-- Enterprise tier's 7-11 line items are usually one packaged capability,
-- not 7-11 independent features). Related bullets within the SAME tier
-- are grouped into one module where they clearly represent one package
-- (e.g. Field Enterprise's SSO + AD Integration + Custom ERP Modules +
-- Data Warehouse Integration + Disaster Recovery -> one
-- field_enterprise_infrastructure module). Bullets that reappear
-- worded differently across 2+ products (e.g. "Multi-branch/-outlet/
-- -property/-plant/-terminal/-department/-campus Management") map to
-- ONE shared module. Spec-only bullets (user/branch/storage counts) and
-- support-row lines (Email/WhatsApp Support, Free Software Updates) are
-- excluded — they're plan limits/support-tier attributes, not modules.
--
-- INCREMENTAL RULE: once a module is unlocked at a tier, it is NOT
-- re-inserted at that product's higher tiers, even if later tier copy
-- re-mentions an upgraded version of it (e.g. Field Business's "Dedicated
-- Success Manager" and Enterprise's "Dedicated Account Manager" both
-- reuse the SAME dedicated_support_contact row already unlocked at
-- Business — cumulative access via tier_order already covers it).
--
-- Result: 19 shared modules + 63 industry-specific modules = 82 total.
-- Higher than the ~15/~45 rough estimate from the earlier skim-level
-- categorization, because full-fidelity mapping across all 28 tiers
-- surfaces more distinct groupings than a first pass suggested — still
-- consolidated, not a raw 1:1 bullet dump (which would have been 150+).
--
-- tier_slug values below match migrations 004's actual seed data exactly
-- (e.g. dine uses 'start' not 'starter'; healthcare uses 'clinic-basic'
-- etc.) — required for the composite FK in 007 to resolve.
--
-- NOT executed yet — review before running against Railway.

-- ── SHARED MODULES (19) ──────────────────────────────────────────────────
INSERT INTO bot_modules (module_slug, module_name, category, description) VALUES
('staff_attendance', 'Staff Attendance', 'shared', 'WhatsApp check-in/check-out attendance tracking for staff/workers/crew/agents'),
('hub_dashboard_basic', 'Basic Hub Dashboard', 'shared', 'Basic KAPA Hub dashboard view with core reports'),
('hub_dashboard_advanced', 'Advanced Hub Dashboard', 'shared', 'Advanced KAPA Hub dashboard with deeper analytics'),
('daily_report_to_owner', 'Daily Report to Owner/Manager', 'shared', 'Scheduled daily WhatsApp summary report (sales, operations, attendance, etc.)'),
('whatsapp_alerts_notifications', 'WhatsApp Alerts & Notifications', 'shared', 'General WhatsApp alert notifications for operational events'),
('multi_location_management', 'Multi-Location Management', 'shared', 'Manage multiple branches/outlets/properties/plants/terminals/departments/campuses from one account'),
('dedicated_support_contact', 'Dedicated Support Contact', 'shared', 'Named dedicated support/success/account/compliance contact'),
('custom_integrations', 'Custom Integrations', 'shared', 'Custom third-party system integrations (API access, ERP, etc.)'),
('franchise_management', 'Franchise Management', 'shared', 'Franchise-level management across multiple licensed operators'),
('maintenance_management', 'Maintenance Management', 'shared', 'Maintenance/breakdown request tracking and scheduling'),
('low_stock_alerts', 'Low Stock Alerts', 'shared', 'Automatic WhatsApp alert when stock falls below reorder threshold'),
('sla_guarantee', 'SLA Guarantee', 'shared', 'Contracted SLA guarantee for support response/uptime, including priority support hours'),
('role_based_access', 'Role-Based Access', 'shared', 'Role-based user access control'),
('crm_pipeline', 'CRM & Sales Pipeline', 'shared', 'CRM and sales/lead pipeline tracking'),
('inventory_management_basic', 'Basic Inventory Management', 'shared', 'Basic stock/inventory tracking'),
('inventory_management_full', 'Full Inventory Management', 'shared', 'Full inventory management with automated alerts'),
('invoicing_billing', 'Invoicing & Billing', 'shared', 'Quotation, invoice and billing generation'),
('pdpa_compliance', 'PDPA Compliance', 'shared', 'PDPA-compliant data handling practices'),
('auto_payroll', 'Automated Payroll', 'shared', 'Automated payroll calculation and processing, including OT where applicable');

-- ── INDUSTRY-SPECIFIC MODULES: FIELD (14) ───────────────────────────────
INSERT INTO bot_modules (module_slug, module_name, category, description) VALUES
('field_org_essentials', 'Field Org Essentials', 'industry_specific', 'Customer & supplier management, employee directory, leave management, email integration, company branding'),
('field_field_ops', 'Field Operations & Task Coordination', 'industry_specific', 'Advanced task management, technician/staff geofencing, WhatsApp task assignment, customer notifications, WhatsApp leave approval'),
('field_ai_invoicing', 'AI Invoicing', 'industry_specific', 'Email invoice fetch and AI-generated invoices/quotations from WhatsApp'),
('field_workflow_permissions', 'Workflow Approvals & Permissions', 'industry_specific', 'Workflow approvals and multi-level user permissions'),
('field_executive_insights', 'Executive & Finance Insights', 'industry_specific', 'Advanced finance reports, executive dashboard, performance dashboard'),
('field_priority_support', 'Priority Email & WhatsApp Support', 'industry_specific', 'Priority-tier email and WhatsApp support channel'),
('field_aibo_assistant', 'AiBo AI Business Assistant', 'industry_specific', 'AI business assistant for field operations'),
('field_automation_workflows', 'Custom Automation Workflows', 'industry_specific', 'Custom approval workflows and advanced workflow automation'),
('field_ops_management', 'Asset/Service/Project Management', 'industry_specific', 'Asset management, service management, project management'),
('field_ai_insights', 'AI Executive Insights', 'industry_specific', 'AI executive reports, performance insights, revenue forecasting, executive KPI dashboard, WhatsApp customer journey automation'),
('field_enterprise_infrastructure', 'Enterprise Infrastructure & Security', 'industry_specific', 'Dedicated/private cloud, enterprise security, SSO, AD integration, unlimited API, custom ERP modules, industry customization, data warehouse integration, advanced audit logs, disaster recovery planning'),
('field_bi_white_label', 'BI Dashboards & White-Label', 'industry_specific', 'Advanced business intelligence dashboards and white-label solution'),
('field_multi_country_currency', 'Multi-Country & Multi-Currency Support', 'industry_specific', 'Support for multiple countries and currencies'),
('field_unlimited_automation_updates', 'Unlimited Automation & Updates', 'industry_specific', 'Unlimited workflow automation and unlimited software updates');

-- ── INDUSTRY-SPECIFIC MODULES: DINE (4) ──────────────────────────────────
INSERT INTO bot_modules (module_slug, module_name, category, description) VALUES
('dine_sales_recording', 'Daily Sales Recording', 'industry_specific', 'Daily sales recording for F&B outlets'),
('dine_pos_kitchen', 'POS & Kitchen Operations', 'industry_specific', 'WhatsApp POS system, kitchen notification (KOT), table management'),
('dine_online_ordering', 'Online Ordering & Delivery Integration', 'industry_specific', 'Online menu/QR ordering, GrabFood/Foodpanda integration, menu management'),
('dine_chain_reports', 'Chain Reports & Analytics', 'industry_specific', 'Reporting and analytics across restaurant chains');

-- ── INDUSTRY-SPECIFIC MODULES: PORTS (5) ─────────────────────────────────
INSERT INTO bot_modules (module_slug, module_name, category, description) VALUES
('ports_task_management', 'Basic Task Management', 'industry_specific', 'Basic task management for port operations'),
('ports_vessel_cargo_ops', 'Vessel & Cargo Operations', 'industry_specific', 'Vessel & fleet tracking, cargo & container management'),
('ports_overtime_shift', 'Overtime & Shift Management', 'industry_specific', 'Overtime and shift management for crew/staff'),
('ports_customs_compliance', 'Customs & Compliance Tracking', 'industry_specific', 'Customs and compliance tracking for port operations'),
('ports_integrated_pms', 'Integrated Port Management System', 'industry_specific', 'Full integrated port management system');

-- ── INDUSTRY-SPECIFIC MODULES: HEALTHCARE (5) ────────────────────────────
INSERT INTO bot_modules (module_slug, module_name, category, description) VALUES
('healthcare_patient_appointment', 'Patient Appointment via WhatsApp', 'industry_specific', 'Patient appointment booking via WhatsApp'),
('healthcare_patient_mgmt', 'Patient Management & History', 'industry_specific', 'Patient management and medical history tracking'),
('healthcare_insurance_claims', 'Insurance Claims Tracking', 'industry_specific', 'Insurance claims tracking'),
('healthcare_doctor_scheduling', 'Doctor Scheduling & On-call', 'industry_specific', 'Doctor scheduling and on-call management'),
('healthcare_pharmacy_mgmt', 'Pharmacy Management', 'industry_specific', 'Pharmacy inventory and dispensing management');

-- ── INDUSTRY-SPECIFIC MODULES: EDUCATION (8) ─────────────────────────────
INSERT INTO bot_modules (module_slug, module_name, category, description) VALUES
('education_student_attendance', 'Student Attendance with Parent Notification', 'industry_specific', 'Student attendance tracking with automatic parent notification'),
('education_fee_reminders', 'Basic Fee Reminders', 'industry_specific', 'Basic fee reminders via WhatsApp'),
('education_fee_collection', 'Full Fee Collection & Receipts', 'industry_specific', 'Full fee collection and receipt generation'),
('education_parent_portal', 'Parent Communication Portal', 'industry_specific', 'Parent communication portal'),
('education_academic_calendar', 'Academic Calendar & Events', 'industry_specific', 'Academic calendar and events management'),
('education_teacher_leave', 'Teacher Leave Management', 'industry_specific', 'Leave management for teaching staff'),
('education_online_learning', 'Online Learning Integration', 'industry_specific', 'Online learning platform integration'),
('education_alumni_mgmt', 'Alumni Management', 'industry_specific', 'Alumni database and engagement management');

-- ── INDUSTRY-SPECIFIC MODULES: HOTELS (8) ────────────────────────────────
INSERT INTO bot_modules (module_slug, module_name, category, description) VALUES
('hotels_housekeeping', 'Housekeeping Task Management', 'industry_specific', 'Housekeeping task assignment and tracking'),
('hotels_guest_requests', 'Guest Request via WhatsApp', 'industry_specific', 'Guest service requests via WhatsApp'),
('hotels_room_status', 'Room Status Management', 'industry_specific', 'Real-time room status management'),
('hotels_fb_staff_mgmt', 'F&B Staff Management', 'industry_specific', 'Food & beverage staff management'),
('hotels_guest_satisfaction', 'Guest Satisfaction Follow-up', 'industry_specific', 'Post-stay guest satisfaction follow-up'),
('hotels_event_banquet', 'Event & Banquet Management', 'industry_specific', 'Event and banquet booking management'),
('hotels_channel_manager', 'Channel Manager Integration', 'industry_specific', 'Integration with OTA channel managers'),
('hotels_revenue_mgmt_reports', 'Revenue Management Reports', 'industry_specific', 'Revenue management reporting');

-- ── INDUSTRY-SPECIFIC MODULES: RETAIL (5) ────────────────────────────────
INSERT INTO bot_modules (module_slug, module_name, category, description) VALUES
('retail_sales_recording', 'Daily Sales Recording', 'industry_specific', 'Daily sales recording for retail outlets'),
('retail_supplier_mgmt', 'Supplier & Purchase Management', 'industry_specific', 'Supplier and purchase order management'),
('retail_customer_orders', 'Customer Order via WhatsApp', 'industry_specific', 'Customer order placement via WhatsApp'),
('retail_centralized_control', 'Centralized Multi-Branch Control', 'industry_specific', 'Centralized control across retail branches'),
('retail_advanced_analytics', 'Advanced Analytics & Reports', 'industry_specific', 'Advanced retail analytics and reporting');

-- ── INDUSTRY-SPECIFIC MODULES: MANUFACTURING (7) ─────────────────────────
INSERT INTO bot_modules (module_slug, module_name, category, description) VALUES
('manufacturing_production_tracking', 'Basic Production Tracking', 'industry_specific', 'Basic production output tracking'),
('manufacturing_breakdown_reporting', 'Breakdown Reporting via WhatsApp', 'industry_specific', 'Equipment breakdown reporting via WhatsApp'),
('manufacturing_production_line_mgmt', 'Full Production Line Management', 'industry_specific', 'Full production line management'),
('manufacturing_quality_control', 'Quality Control Checklists', 'industry_specific', 'Quality control inspection checklists'),
('manufacturing_raw_material_inventory', 'Raw Material Inventory', 'industry_specific', 'Raw material inventory tracking'),
('manufacturing_oee_analytics', 'OEE & Efficiency Analytics', 'industry_specific', 'Overall equipment effectiveness and efficiency analytics'),
('manufacturing_compliance_audit', 'Compliance & Audit Management', 'industry_specific', 'Compliance and audit management for manufacturing');

-- ── INDUSTRY-SPECIFIC MODULES: FINANCE (7) ───────────────────────────────
INSERT INTO bot_modules (module_slug, module_name, category, description) VALUES
('finance_client_visit_reporting', 'Client Visit Reporting', 'industry_specific', 'Client visit reporting for field agents'),
('finance_compliance_checklist', 'Compliance Checklist Management', 'industry_specific', 'Compliance checklist management'),
('finance_document_tracking', 'Document Tracking & Alerts', 'industry_specific', 'Document tracking with expiry/gap alerts'),
('finance_commission_calc', 'Commission Calculation', 'industry_specific', 'Agent commission calculation'),
('finance_regulatory_reporting', 'Regulatory Reporting', 'industry_specific', 'Regulatory compliance reporting'),
('finance_advanced_analytics', 'Advanced Analytics', 'industry_specific', 'Advanced financial analytics'),
('finance_core_banking_api', 'Core Banking API Integration', 'industry_specific', 'API integration with core banking systems');

-- ── TIER MODULE MAPPING (incremental — only newly unlocked modules per tier) ──

-- FIELD (starter, professional, business, enterprise)
INSERT INTO bot_tier_modules (product_slug, tier_slug, module_slug) VALUES
('field','starter','hub_dashboard_basic'), ('field','starter','crm_pipeline'), ('field','starter','invoicing_billing'),
('field','starter','inventory_management_basic'), ('field','starter','staff_attendance'), ('field','starter','role_based_access'),
('field','starter','field_org_essentials'),
('field','professional','auto_payroll'), ('field','professional','field_field_ops'), ('field','professional','field_ai_invoicing'),
('field','professional','field_workflow_permissions'), ('field','professional','field_executive_insights'), ('field','professional','field_priority_support'),
('field','business','field_aibo_assistant'), ('field','business','custom_integrations'), ('field','business','field_automation_workflows'),
('field','business','inventory_management_full'), ('field','business','field_ops_management'), ('field','business','field_ai_insights'),
('field','business','dedicated_support_contact'),
('field','enterprise','field_enterprise_infrastructure'), ('field','enterprise','field_bi_white_label'), ('field','enterprise','field_multi_country_currency'),
('field','enterprise','sla_guarantee'), ('field','enterprise','field_unlimited_automation_updates');

-- DINE (start, pro, enterprise)
INSERT INTO bot_tier_modules (product_slug, tier_slug, module_slug) VALUES
('dine','start','staff_attendance'), ('dine','start','low_stock_alerts'), ('dine','start','inventory_management_basic'),
('dine','start','dine_sales_recording'), ('dine','start','hub_dashboard_basic'), ('dine','start','daily_report_to_owner'),
('dine','pro','dine_pos_kitchen'), ('dine','pro','dine_online_ordering'), ('dine','pro','hub_dashboard_advanced'),
('dine','enterprise','multi_location_management'), ('dine','enterprise','dine_chain_reports'), ('dine','enterprise','franchise_management'),
('dine','enterprise','custom_integrations'), ('dine','enterprise','dedicated_support_contact'), ('dine','enterprise','sla_guarantee');

-- PORTS (starter, professional, enterprise)
INSERT INTO bot_tier_modules (product_slug, tier_slug, module_slug) VALUES
('ports','starter','staff_attendance'), ('ports','starter','ports_task_management'), ('ports','starter','daily_report_to_owner'),
('ports','starter','whatsapp_alerts_notifications'), ('ports','starter','hub_dashboard_basic'),
('ports','professional','ports_vessel_cargo_ops'), ('ports','professional','ports_overtime_shift'), ('ports','professional','auto_payroll'),
('ports','professional','hub_dashboard_advanced'),
('ports','enterprise','multi_location_management'), ('ports','enterprise','ports_customs_compliance'), ('ports','enterprise','ports_integrated_pms'),
('ports','enterprise','dedicated_support_contact'), ('ports','enterprise','custom_integrations'), ('ports','enterprise','sla_guarantee');

-- HEALTHCARE (clinic-basic, clinic-pro, hospital-enterprise)
INSERT INTO bot_tier_modules (product_slug, tier_slug, module_slug) VALUES
('healthcare','clinic-basic','staff_attendance'), ('healthcare','clinic-basic','healthcare_patient_appointment'),
('healthcare','clinic-basic','inventory_management_basic'), ('healthcare','clinic-basic','daily_report_to_owner'), ('healthcare','clinic-basic','hub_dashboard_basic'),
('healthcare','clinic-pro','inventory_management_full'), ('healthcare','clinic-pro','healthcare_patient_mgmt'), ('healthcare','clinic-pro','invoicing_billing'),
('healthcare','clinic-pro','healthcare_insurance_claims'), ('healthcare','clinic-pro','hub_dashboard_advanced'),
('healthcare','hospital-enterprise','multi_location_management'), ('healthcare','hospital-enterprise','healthcare_doctor_scheduling'),
('healthcare','hospital-enterprise','healthcare_pharmacy_mgmt'), ('healthcare','hospital-enterprise','pdpa_compliance'),
('healthcare','hospital-enterprise','dedicated_support_contact'), ('healthcare','hospital-enterprise','custom_integrations');

-- EDUCATION (school-starter, school-pro, institution-enterprise)
INSERT INTO bot_tier_modules (product_slug, tier_slug, module_slug) VALUES
('education','school-starter','staff_attendance'), ('education','school-starter','education_student_attendance'),
('education','school-starter','education_fee_reminders'), ('education','school-starter','daily_report_to_owner'), ('education','school-starter','hub_dashboard_basic'),
('education','school-pro','education_fee_collection'), ('education','school-pro','education_parent_portal'),
('education','school-pro','education_academic_calendar'), ('education','school-pro','education_teacher_leave'), ('education','school-pro','hub_dashboard_advanced'),
('education','institution-enterprise','multi_location_management'), ('education','institution-enterprise','education_online_learning'),
('education','institution-enterprise','education_alumni_mgmt'), ('education','institution-enterprise','pdpa_compliance'),
('education','institution-enterprise','dedicated_support_contact'), ('education','institution-enterprise','custom_integrations');

-- HOTELS (guesthouse, hotel-pro, resort-enterprise)
INSERT INTO bot_tier_modules (product_slug, tier_slug, module_slug) VALUES
('hotels','guesthouse','staff_attendance'), ('hotels','guesthouse','hotels_housekeeping'), ('hotels','guesthouse','hotels_guest_requests'),
('hotels','guesthouse','daily_report_to_owner'), ('hotels','guesthouse','hub_dashboard_basic'),
('hotels','hotel-pro','hotels_room_status'), ('hotels','hotel-pro','hotels_fb_staff_mgmt'), ('hotels','hotel-pro','maintenance_management'),
('hotels','hotel-pro','hotels_guest_satisfaction'), ('hotels','hotel-pro','hub_dashboard_advanced'),
('hotels','resort-enterprise','multi_location_management'), ('hotels','resort-enterprise','hotels_event_banquet'),
('hotels','resort-enterprise','hotels_channel_manager'), ('hotels','resort-enterprise','hotels_revenue_mgmt_reports'),
('hotels','resort-enterprise','dedicated_support_contact'), ('hotels','resort-enterprise','custom_integrations');

-- RETAIL (shop-starter, retail-pro, chain-enterprise)
INSERT INTO bot_tier_modules (product_slug, tier_slug, module_slug) VALUES
('retail','shop-starter','staff_attendance'), ('retail','shop-starter','inventory_management_basic'), ('retail','shop-starter','retail_sales_recording'),
('retail','shop-starter','low_stock_alerts'), ('retail','shop-starter','hub_dashboard_basic'),
('retail','retail-pro','multi_location_management'), ('retail','retail-pro','retail_supplier_mgmt'), ('retail','retail-pro','retail_customer_orders'),
('retail','retail-pro','daily_report_to_owner'), ('retail','retail-pro','hub_dashboard_advanced'),
('retail','chain-enterprise','retail_centralized_control'), ('retail','chain-enterprise','retail_advanced_analytics'),
('retail','chain-enterprise','custom_integrations'), ('retail','chain-enterprise','franchise_management'), ('retail','chain-enterprise','dedicated_support_contact');

-- MANUFACTURING (factory-basic, factory-pro, enterprise-factory)
INSERT INTO bot_tier_modules (product_slug, tier_slug, module_slug) VALUES
('manufacturing','factory-basic','staff_attendance'), ('manufacturing','factory-basic','manufacturing_production_tracking'),
('manufacturing','factory-basic','manufacturing_breakdown_reporting'), ('manufacturing','factory-basic','daily_report_to_owner'), ('manufacturing','factory-basic','hub_dashboard_basic'),
('manufacturing','factory-pro','manufacturing_production_line_mgmt'), ('manufacturing','factory-pro','manufacturing_quality_control'),
('manufacturing','factory-pro','maintenance_management'), ('manufacturing','factory-pro','manufacturing_raw_material_inventory'), ('manufacturing','factory-pro','auto_payroll'),
('manufacturing','enterprise-factory','multi_location_management'), ('manufacturing','enterprise-factory','manufacturing_oee_analytics'),
('manufacturing','enterprise-factory','custom_integrations'), ('manufacturing','enterprise-factory','manufacturing_compliance_audit'),
('manufacturing','enterprise-factory','dedicated_support_contact');

-- FINANCE (agency-starter, financial-firm-pro, enterprise-finance)
INSERT INTO bot_tier_modules (product_slug, tier_slug, module_slug) VALUES
('finance','agency-starter','staff_attendance'), ('finance','agency-starter','finance_client_visit_reporting'), ('finance','agency-starter','crm_pipeline'),
('finance','agency-starter','daily_report_to_owner'), ('finance','agency-starter','hub_dashboard_basic'),
('finance','financial-firm-pro','finance_compliance_checklist'), ('finance','financial-firm-pro','finance_document_tracking'),
('finance','financial-firm-pro','finance_commission_calc'), ('finance','financial-firm-pro','hub_dashboard_advanced'),
('finance','enterprise-finance','multi_location_management'), ('finance','enterprise-finance','finance_regulatory_reporting'),
('finance','enterprise-finance','finance_advanced_analytics'), ('finance','enterprise-finance','finance_core_banking_api'),
('finance','enterprise-finance','dedicated_support_contact'), ('finance','enterprise-finance','custom_integrations');
