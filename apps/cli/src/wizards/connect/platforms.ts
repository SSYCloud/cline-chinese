import {
	CONNECTOR_PLATFORMS,
	shouldIncludeConnectorField,
} from "@coohu/shared";

export type {
	ConnectorFieldCondition as FieldCondition,
	ConnectorFieldDef as FieldDef,
	ConnectorPlatformDef as PlatformDef,
	ConnectorSecurityDef as SecurityDef,
	ConnectorSecurityFieldDef as SecurityFieldDef,
} from "@coohu/shared";
export { CONNECTOR_PLATFORMS, shouldIncludeConnectorField };

export const PLATFORMS = CONNECTOR_PLATFORMS;
export const shouldIncludeField = shouldIncludeConnectorField;
