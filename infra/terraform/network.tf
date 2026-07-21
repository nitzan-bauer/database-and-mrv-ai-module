# =====================================================================
# VPC — two public and two private subnets across two AZs.
#
# No NAT gateway. Nothing in the private subnets needs outbound internet
# yet, and a NAT gateway is ~$33/month before data charges. Add one in
# Stage 6 when the model runners (which do need to pull images) land.
# =====================================================================

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${var.project_name}-${var.environment}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project_name}-${var.environment}-igw" }
}

# RDS requires a subnet group spanning at least two AZs, even single-AZ.
resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "${var.project_name}-${var.environment}-public-${count.index + 1}"
    Tier = "public"
  }
}

resource "aws_subnet" "private" {
  count = 2

  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "${var.project_name}-${var.environment}-private-${count.index + 1}"
    Tier = "private"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.project_name}-${var.environment}-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# ---------------------------------------------------------------------
# Security group — Postgres ingress only from the CIDRs named explicitly,
# plus anything else inside the VPC (future app/model-runner tasks).
# ---------------------------------------------------------------------
resource "aws_security_group" "db" {
  name        = "${var.project_name}-${var.environment}-db"
  description = "Postgres access for the MRV database"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project_name}-${var.environment}-db-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_admin" {
  count = length(var.allowed_admin_cidrs)

  security_group_id = aws_security_group.db.id
  description       = "Postgres from a named admin CIDR"
  cidr_ipv4         = var.allowed_admin_cidrs[count.index]
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_ingress_rule" "db_from_vpc" {
  security_group_id = aws_security_group.db.id
  description       = "Postgres from inside the VPC"
  cidr_ipv4         = var.vpc_cidr
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "db_all" {
  security_group_id = aws_security_group.db.id
  description       = "Allow all outbound"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
