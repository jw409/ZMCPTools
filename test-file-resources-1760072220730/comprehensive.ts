import { Component } from 'react';
import type { Props, State } from './types';
import * as Utils from './utils';

export interface UserData {
  id: number;
  name: string;
  email: string;
}

export class UserComponent extends Component<Props, State> {
  private userId: number;

  constructor(props: Props) {
    super(props);
    this.userId = props.id;
  }

  public render() {
    return <div>User: {this.props.name}</div>;
  }

  private handleClick() {
    console.log('clicked');
  }
}

export function getUserById(id: number): UserData | null {
  return null;
}

export const API_ENDPOINT = 'https://api.example.com';
export const VERSION = '1.0.0';