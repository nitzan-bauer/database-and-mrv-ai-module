terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state. Create the bucket and lock table once, by hand, then
  # uncomment — chicken-and-egg means they cannot be managed by this stack.
  #
  #   aws s3api create-bucket --bucket carbonature-tfstate \
  #     --region eu-west-1 --create-bucket-configuration LocationConstraint=eu-west-1
  #   aws s3api put-bucket-versioning --bucket carbonature-tfstate \
  #     --versioning-configuration Status=Enabled
  #
  # backend "s3" {
  #   bucket       = "carbonature-tfstate"
  #   key          = "mrv/terraform.tfstate"
  #   region       = "eu-west-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "carbonature-mrv"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
